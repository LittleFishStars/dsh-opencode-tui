#!/usr/bin/env python3
"""PTY 测试 v8：opencode attach <url> —— 官方 TUI 连接外部 server 的集成路径验证。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["XDG_CONFIG_HOME"] = os.path.join(ROOT, ".xdg-config6")
ENV["XDG_DATA_HOME"] = os.path.join(ROOT, ".xdg-data6")
ENV["XDG_STATE_HOME"] = os.path.join(ROOT, ".xdg-state6")
ENV["XDG_CACHE_HOME"] = os.path.join(ROOT, ".xdg-cache6")

BIN = os.path.join(ROOT, "node_modules", "opencode-ai", "bin", "opencode.exe")
OUT = os.path.join(ROOT, "raw8.bin")

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen([BIN, "attach", "http://127.0.0.1:4199"], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
resp = TermResponder(master)

def extract(data):
    import re
    tokens = re.split(rb'(\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_G[^\x1b]*\x1b\\|\x1bP[^\x1b]*\x1b\\|\x1b[c=>()0-9A-FM78]|\x1b[78])', data)
    out = []
    for t in tokens:
        if t.startswith(b"\x1b"):
            continue
        for ch in t:
            if ch >= 32 and ch not in b" ":
                out.append(chr(ch))
    return "".join(out)

with open(OUT, "wb") as f:
    buf = b""
    end = time.time() + 25
    last = 0
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.3)
        if not r:
            continue
        try:
            d = os.read(master, 65536)
        except OSError:
            break
        if not d:
            break
        f.write(d)
        f.flush()
        buf += d
        now = time.time()
        if now - last > 5:
            last = now
            print(f"--- @{int(now - (end - 25))}s: {extract(buf)[-300:]!r}")
    print("FINAL VISIBLE:", repr(extract(buf)[-800:]))

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print(f"captured {os.path.getsize(OUT)} bytes -> {OUT}")
