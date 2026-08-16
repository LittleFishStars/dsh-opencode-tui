#!/usr/bin/env python3
"""PTY 测试 v11：dsh --profile dsh-opencode-tui 端到端（兼容层 + lildax TUI）。

流程：启动 → 观察渲染（provider 非空应显示 home/输入框）→ 发消息
→ DSH agent 回复（文本/工具）→ 验证渲染。
"""
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
ENV["XDG_CONFIG_HOME"] = os.path.join(ROOT, ".xdg-config11")
ENV["XDG_DATA_HOME"] = os.path.join(ROOT, ".xdg-data11")
ENV["XDG_STATE_HOME"] = os.path.join(ROOT, ".xdg-state11")
ENV["XDG_CACHE_HOME"] = os.path.join(ROOT, ".xdg-cache11")
for d in (ENV["XDG_CONFIG_HOME"], ENV["XDG_DATA_HOME"], ENV["XDG_STATE_HOME"], ENV["XDG_CACHE_HOME"]):
    os.makedirs(d, exist_ok=True)

COLS, ROWS = 120, 36
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
resp = TermResponder(master)

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

def send(s, delay=0.4):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(delay)

def check(label, needles, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(0.5)
        t = extract(buf)
        for n in needles:
            if n in t:
                print(f"[OK] {label}: {n!r}", flush=True)
                return True
    print(f"[FAIL] {label}: {needles}", flush=True)
    print("  visible:", repr(t[-400:]), flush=True)
    return False

drain(15)
print("BOOT:", repr(extract(buf)[-300:]), flush=True)

# 发消息
send("reply with the single word HELLOWORLD and nothing else")
send("\r")
check("reply text", ["HELLOWORLD"], timeout=120)
drain(1)
print("TAIL:", repr(extract(buf)[-600:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print("done")
