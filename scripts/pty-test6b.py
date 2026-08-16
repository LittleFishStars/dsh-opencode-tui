#!/usr/bin/env python3
"""PTY 测试 v6b：官方预编译 opencode-ai@1.18.18 —— 完整观察启动后主界面。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from miniterm import MiniTerm
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
os.makedirs(ENV["XDG_CACHE_HOME"], exist_ok=True)

BIN = os.path.join(ROOT, "node_modules", "opencode-ai", "bin", "opencode.exe")

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen([BIN], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
resp = TermResponder(master)
term = MiniTerm(COLS, ROWS)

def drain(t=1.0):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.2)
        if not r:
            continue
        try:
            term.feed(os.read(master, 65536).decode("utf-8", "replace"))
        except OSError:
            break

def send(s, delay=0.4):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(delay)

# 阶段 1：等待 20s，逐步 dump
for t in (6, 10, 20):
    drain(6 if t == 6 else t - (6 if t == 6 else 10))
    print(f"===== FRAME @ {t}s =====")
    print(term.frame())

# 阶段 2：输入一行文字 + 回车
send("hi from pty-test6b", 0.5)
send("\r")
drain(3)
print("===== FRAME AFTER INPUT =====")
print(term.frame())
drain(8)
print("===== FRAME AFTER 8s MORE =====")
print(term.frame())

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print("=== EXIT ===")
