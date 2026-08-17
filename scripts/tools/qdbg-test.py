#!/usr/bin/env python3
"""验证 question.asked 事件 → TUI 对话框（用 debug 端点受控触发）。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
ENV["DSH_OPENCODE_TUI_SERVER_PORT"] = "4109"
ENV["DSH_OC_DEBUG"] = "1"
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV[k], exist_ok=True)

errf = open("test-qdbg-err.log", "wb")
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

drain(12)
print("BOOT OK", flush=True)
# 触发 debug question
try:
    req = urllib.request.Request("http://127.0.0.1:4109/_debug/question", method="POST", data=b"{}")
    with urllib.request.urlopen(req, timeout=3) as r:
        print("debug POST:", r.status, flush=True)
except Exception as e:
    print("debug POST failed:", e, flush=True)

deadline = time.time() + 15
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if "Debug question" in t or ("pick a color" in t and "Red" in t):
        print("[OK] question dialog rendered via event", flush=True)
        idx = t.rfind("Debug")
        print("  dialog:", repr(t[max(0,idx-50):idx+150]), flush=True)
        break
else:
    print("[FAIL] no dialog", flush=True)
    print("TAIL:", repr(extract(buf)[-500:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
