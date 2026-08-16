#!/usr/bin/env python3
"""PTY 测试 v9：fork dev 构建的 lildax 二进制，默认命令 + term_responder。
验证：daemon spawn serve --register 成功 + TUI 完整渲染。"""
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
for d in (ENV["XDG_CONFIG_HOME"], ENV["XDG_DATA_HOME"], ENV["XDG_STATE_HOME"], ENV["XDG_CACHE_HOME"]):
    os.makedirs(d, exist_ok=True)

BIN = os.path.join(ROOT, "opencode-fork", "packages", "cli", "dist", "cli-linux-x64", "bin", "lildax")
OUT = os.path.join(ROOT, "raw9.bin")

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

with open(OUT, "wb") as f:
    buf = b""
    end = time.time() + 30
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
            print(f"--- @{int(now - (end - 30))}s: {extract(buf)[-250:]!r}", flush=True)
    print("FINAL VISIBLE:", repr(extract(buf)[-900:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print(f"captured {os.path.getsize(OUT)} bytes -> {OUT}")
