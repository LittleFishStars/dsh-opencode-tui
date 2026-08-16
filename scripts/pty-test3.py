#!/usr/bin/env python3
"""PTY 测试 v3：内联迷你终端模拟器，渲染真实屏幕帧验证 UI。"""
import os, pty, select, sys, time, subprocess, re, fcntl, termios, struct, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from miniterm import MiniTerm

CWD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["DSH_HOME"] = os.path.join(CWD, ".dsh-home")
ENV["NODE_ENV"] = "production"

def ensure_test_env():
    """自举测试环境：profile + 依赖 + 凭据（凭据缺失时跳过真实模型调用）。"""
    import shutil
    profile = os.path.join(ENV["DSH_HOME"], "profiles", "opencode")
    if os.path.exists(os.path.join(profile, "node_modules", "dsh-opencode-tui")):
        return
    os.makedirs(profile, exist_ok=True)
    manifest = (
        '{\n'
        '  "name": "dsh-profile-opencode",\n'
        '  "private": true,\n'
        '  "dependencies": { "dsh-opencode-tui": "link:%s" },\n'
        '  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-opencode-tui"] } }\n'
        '}\n'
    ) % CWD
    with open(os.path.join(profile, "package.json"), "w") as f:
        f.write(manifest)
    with open(os.path.join(profile, "cordis.patch.yml"), "w") as f:
        f.write("[]\n")
    with open(os.path.join(profile, ".npmrc"), "w") as f:
        f.write("store-dir=%s\n" % os.path.join(ENV["DSH_HOME"], "pnpm-store"))
    home = os.path.expanduser("~/.dsh")
    for name in (".credentials.yaml", "settings.yaml"):
        src = os.path.join(home, name)
        if os.path.exists(src):
            shutil.copy(src, ENV["DSH_HOME"])
    subprocess.run(
        ["pnpm", "install", "--store-dir", os.path.join(ENV["DSH_HOME"], "pnpm-store")],
        cwd=profile, check=False,
    )

ensure_test_env()

sessions = glob.glob(os.path.join(CWD, ".dsh-home", "sessions", "*", "*", "session.jsonl.zstd"))
resume_id = None
if sessions:
    m = re.search(r"session-([0-9a-f-]+)", sessions[0])
    if m:
        resume_id = "session-" + m.group(1)
print("RESUME_ID:", resume_id)

COLS, ROWS = 120, 36
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))

proc = subprocess.Popen(
    ["dsh", "--profile", "opencode"] + (["--resume", resume_id] if resume_id else []),
    cwd=CWD, env=ENV, stdin=slave, stdout=slave, stderr=slave, close_fds=True,
)
os.close(slave)
term = MiniTerm(COLS, ROWS)

def drain(timeout=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r, _, _ = select.select([master], [], [], 0.1)
        if not r:
            continue
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        term.feed(data.decode("utf-8", "replace"))

def send(s, delay=0.4):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(delay)

def shot(label):
    drain(0.6)
    print(f"───── {label} ─────")
    print(term.frame())

def check(label, needles, timeout=6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(0.5)
        t = term.frame()
        for n in needles:
            if n in t:
                print(f"[OK] {label}: {n!r}")
                return True
    print(f"[FAIL] {label}: {needles}")
    print(term.frame())
    return False

drain(8)
shot("BOOT")

# help via ?
send("?")
check("help dialog", ["Help", "toggle help"])
send("\x1b")
time.sleep(0.4)

# sessions dialog
send("\x13")
check("sessions dialog", ["Sessions"])
shot("SESSIONS DIALOG")
send("\x1b")
time.sleep(0.4)

# commands dialog
send("\x0b")
check("commands dialog", ["Commands"])
shot("COMMANDS DIALOG")
send("\x1b")
time.sleep(0.4)

# theme dialog → dracula
send("\x14")
check("theme dialog", ["Theme"])
send("dracula")
time.sleep(0.3)
send("\r")
time.sleep(0.5)
shot("THEME SWITCHED")

# 新消息
send("what is 2+2? answer with just the number")
send("\r")
check("assistant reply", ["2+2"], timeout=90)
drain(2)
shot("REPLY")

# ctrl+n 新会话
send("\x0e")
time.sleep(1.2)
shot("NEW SESSION")

# 审批/提问面板不会出现；直接退出
send("\x03")
time.sleep(0.5)
shot("QUIT DIALOG")
send("\r")
time.sleep(2)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
print("=== EXIT rc:", proc.returncode, "===")
