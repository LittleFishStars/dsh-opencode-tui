#!/usr/bin/env python3
"""PTY 测试 v14：工具调用场景（bash 工具 → thinking/工具块渲染）。"""
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

errf = open("test14-err.log", "wb")
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

# 触发 bash 工具：让 agent 运行 echo 并回复输出
PROMPT = "run the shell command `echo TOOLCALL-OK-42` and then reply with exactly the output"
send(PROMPT)
send("\r")
deadline = time.time() + 150
sent_ok = False
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if not sent_ok:
        if PROMPT not in t:
            sent_ok = True
            print("[OK] prompt submitted", flush=True)
        continue
    if "TOOLCALL-OK-42" in t and "run the shell command" not in t[-2000:]:
        print("[OK] tool call output rendered: TOOLCALL-OK-42", flush=True)
        print("TAIL:", repr(t[-800:]), flush=True)
        break
else:
    t = extract(buf)
    print("[FAIL] no tool output", flush=True)
    print("TAIL:", repr(t[-1000:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
