#!/usr/bin/env python3
"""PTY 测试 v17：用户提问对话框（agent askUserQuestion → TUI question 流）。"""
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

errf = open("test17-err.log", "wb")
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

# 触发 askUserQuestion：让 agent 提问
PROMPT = "use the ask_user_question tool to ask me a single-choice question about my favorite color, with options Red, Green, Blue. Then wait for my answer."
send(PROMPT)
send("\r")
deadline = time.time() + 100
dialog_seen = False
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if not dialog_seen:
        if "Red" in t and "Green" in t and "Blue" in t and "ask_user_question" not in t[-3000:]:
            dialog_seen = True
            print("[OK] question dialog rendered", flush=True)
            idx = t.rfind("Red")
            print("  dialog:", repr(t[max(0,idx-200):idx+120]), flush=True)
    if dialog_seen:
        break
if not dialog_seen:
    print("[FAIL] no question dialog", flush=True)
    print("TAIL:", repr(extract(buf)[-600:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
