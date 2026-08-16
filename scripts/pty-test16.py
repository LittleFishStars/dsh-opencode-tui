#!/usr/bin/env python3
"""PTY 测试 v16：审批对话框完整流程（触发 → 对话框 → Enter 批准 → 工具执行）。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV[k], exist_ok=True)

errf = open("test16-err.log", "wb")
COLS, ROWS = 120, 36
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=errf, close_fds=True)
os.close(slave)
resp = TermResponder(master, threaded=False)

PAT = rb'(\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_G[^\x1b]*\x1b\\|\x1bP[^\x1b]*\x1b\\|\x1b[c=>()0-9A-FM78]|\x1b[78])'
def extract(data):
    tokens = re.split(PAT, data)
    out = []
    for t in tokens:
        if t.startswith(b"\x1b"):
            continue
        for ch in t:
            if ch >= 32 and ch not in b" ":
                out.append(chr(ch))
    return "".join(out)

buf = b""
def drain(t=1.0):
    global buf
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.2)
        if not r:
            continue
        try:
            d = os.read(master, 65536)
        except OSError:
            return
        if not d:
            return
        buf += d
        replies = resp.feed_sync(d)
        if replies:
            try:
                os.write(master, replies)
            except OSError:
                pass

def send(s, delay=0.4):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(delay)

drain(15)
print("BOOT OK:", "Ask anything" in extract(buf) or "agents" in extract(buf), flush=True)

PROMPT = "use bash to write the text APPROVAL-DONE to the file /tmp/approval-test-dsh.txt (outside the workspace, requires permission)"
send(PROMPT)
send("\r")

deadline = time.time() + 60
dialog_seen = False
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if not dialog_seen and "Allow" in t and "Reject" in t:
        dialog_seen = True
        print("[OK] permission dialog rendered", flush=True)
        # 等 keymap 就绪后默认选中第一个选项（Allow once），Enter 批准
        time.sleep(1.5)
        send("\r")
        print("[OK] pressed Enter to approve", flush=True)
        break
else:
    print("[FAIL] no permission dialog", flush=True)

# 等待审批结果：会话文件里出现 approval/decided allowed-once
# 注意：不用 glob（沙箱里 glob 通配扫描只见目录不见文件），用 os.walk 递归扫描。
def find_session_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn == "session.jsonl.zstd":
                out.append(os.path.join(dirpath, fn))
    return out

deadline = time.time() + 45
while time.time() < deadline:
    time.sleep(2)
    files = find_session_files(os.path.join(ROOT, ".oc-sessions"))
    if not files:
        continue
    hit = False
    for f in files:
        out = subprocess.run(["zstd", "-d", "-c", f], capture_output=True).stdout.decode("utf-8", "replace")
        if "allowed-once" in out:
            hit = True
            break
    if hit:
        print("[OK] approval decided: allowed-once", flush=True)
        break
else:
    print("[FAIL] approval not decided", flush=True)
    print("  tail:", repr(extract(buf)[-500:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
