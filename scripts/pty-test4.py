#!/usr/bin/env python3
"""PTY 测试 v4：鼠标操作 + 折叠展开 + 背景色验证。

流程：启动 → 检查背景 SGR → 发送触发工具调用的消息 → 定位折叠头坐标 →
注入鼠标点击（展开 thinking / 工具调用）→ 滚轮滚动 → 会话对话框点击。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, re, sys, shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from miniterm import MiniTerm

CWD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["DSH_HOME"] = os.path.join(CWD, ".dsh-home")
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"

def ensure_test_env():
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

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(
    ["dsh", "--profile", "opencode"],
    cwd=CWD, env=ENV, stdin=slave, stdout=slave, stderr=slave, close_fds=True,
)
os.close(slave)
term = MiniTerm(COLS, ROWS)
raw_stream = bytearray()

def drain(t=1.0):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if not r:
            continue
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        raw_stream.extend(data)
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

def find_row(fragment):
    """在帧中找包含 fragment 的行号（1-based 屏幕行）。"""
    lines = term.frame().split("\n")
    for i, line in enumerate(lines):
        if fragment in line:
            return i + 1
    return None

def click(x, y):
    os.write(master, f"\x1b[<0;{x};{y}M".encode())
    time.sleep(0.15)
    os.write(master, f"\x1b[<0;{x};{y}m".encode())
    time.sleep(0.4)

def wheel(dx, x, y):
    btn = 65 if dx > 0 else 64
    os.write(master, f"\x1b[<{btn};{x};{y}M".encode())
    time.sleep(0.4)

drain(8)
raw = raw_stream.decode("utf-8", "replace")
# 背景色检查：黑底 48;2;13;13;13，侧栏灰 48;2;42;42;42
print("[BG black] ", "48;2;13;13;13" in raw)

# 1) 发送触发工具调用的消息
send("create a file named mouse-test.txt containing the word SPIKED, then run `cat mouse-test.txt` in bash and report the output")
send("\r")
check("tool call appears", ["▸ "], timeout=120)
raw_now = raw_stream.decode("utf-8", "replace")
print("[BG sidebar]", "48;2;42;42;42" in raw_now)
drain(3)
shot("AFTER REPLY")

# 2) 定位 tool 卡折叠头并点击展开（找非 thinking 的 ▸ 行）
lines = term.frame().split("\n")
row = None
for i, line in enumerate(lines):
    if "▸ " in line and "thinking" not in line:
        row = i + 1
        break
if row:
    click(5, row)
    check("tool expanded", ["SPIKED", "Preparing", "denied"], timeout=5)
    shot("TOOL EXPANDED")
else:
    print("[FAIL] no tool row found")

# 3) thinking 折叠（若有）：定位 ▸ thinking 点击展开
trow = find_row("▸ thinking")
if trow:
    click(5, trow)
    time.sleep(1)
    shot("THINKING EXPANDED")
    # 再点折叠回去
    click(5, trow)
    time.sleep(0.6)
    print("[OK] thinking toggle roundtrip")
else:
    print("[INFO] no thinking block this run")

# 4) 滚轮：向上滚 5 格（回看历史）
before = term.frame()
wheel(-1, 40, 15)
wheel(-1, 40, 15)
wheel(-1, 40, 15)
drain(0.8)
after = term.frame()
print("[WHEEL UP] frame changed:", before != after)

# 5) 滚轮滚回底部
for _ in range(10):
    wheel(1, 40, 15)
drain(0.8)

# 6) 会话对话框鼠标点击（确定性坐标：对话框 top=3(0-based)，条目 i 在 y=8+i）
send("\x13")
check("sessions dialog", ["Sessions"])
drain(0.5)
item_row = 8
# 快速双击（down/up 各 0.1s，间隔 <1s 双击窗口）
for _ in range(2):
    os.write(master, f"\x1b[<0;55;{item_row}M".encode())
    time.sleep(0.1)
    os.write(master, f"\x1b[<0;55;{item_row}m".encode())
    time.sleep(0.1)
time.sleep(1.5)
if "Sessions" not in term.frame():
    print("[OK] dialog mouse click double")
else:
    print("[FAIL] dialog still open after double click")
send("\x1b")
time.sleep(0.6)
print("[DBG] dialog open after esc:", "Sessions" in term.frame() or "sure" in term.frame())
# 7) 退出
send("\x03")
time.sleep(0.8)
print("[DBG] quit dialog open:", "sure" in term.frame())
send("\r")
time.sleep(3)
print("[DBG] rc after enter:", proc.poll())

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
print("=== EXIT rc:", proc.returncode, "===")
