#!/usr/bin/env python3
"""PTY 测试 v10：lildax TUI（伪造注册 → record-server 代理）完整交互序列抓取。
启动 → 发消息 → 观察创建会话/agent run 的请求。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["XDG_CONFIG_HOME"] = os.path.join(ROOT, ".xdg-config9")
ENV["XDG_DATA_HOME"] = os.path.join(ROOT, ".xdg-data9")
ENV["XDG_STATE_HOME"] = os.path.join(ROOT, ".xdg-state9")
ENV["XDG_CACHE_HOME"] = os.path.join(ROOT, ".xdg-cache9")

BIN = os.path.join(ROOT, "opencode-fork", "packages", "cli", "dist", "cli-linux-x64", "bin", "lildax")
OUT = os.path.join(ROOT, "raw10.bin")

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen([BIN], cwd=ROOT, env=ENV,
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
        with open(OUT, "ab") as f:
            f.write(d)

drain(12)
print("BOOT:", repr(extract(buf)[-200:]), flush=True)

# 发消息触发会话创建 + agent run
os.write(master, b"say hello")
time.sleep(0.5)
os.write(master, b"\r")
drain(15)
print("AFTER MSG:", repr(extract(buf)[-600:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print("done")
