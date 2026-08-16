#!/usr/bin/env python3
"""PTY 测试 v6：官方预编译 opencode-ai@1.18.18 二进制 + term_responder。

目的：验证官方编译版 TUI 在完整终端应答（kitty/DA1/OSC/DECRQM…）下能否
通过 OpenTUI 握手并渲染出界面（纯 opencode，不接 DSH）。
"""
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
for d in (ENV["XDG_CONFIG_HOME"], ENV["XDG_DATA_HOME"], ENV["XDG_STATE_HOME"]):
    os.makedirs(d, exist_ok=True)

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

def check(label, needles, timeout=8):
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(0.5)
        t = term.frame()
        for n in needles:
            if n in t:
                print(f"[OK] {label}: {n!r}")
                return True
    print(f"[FAIL] {label}: {needles}")
    print(term.frame()[:1000])
    return False

drain(12)
print("=== FIRST FRAME (12s) ===")
print(term.frame()[:1200])

if "Initialize Project" in term.frame():
    send("\t")
    send("\r")
    drain(2)

check("boot", ["⌬", "OpenCode", "opencode"])

if "Initialize Project" not in term.frame() and "OpenCode" not in term.frame():
    # 可能是等待输入 / 连接 server；尝试发送回车或输入
    print("=== no boot marker; dumping raw tail ===")
    print(term.frame()[:1500])

send("\x13")  # ctrl+s sessions
check("sessions dialog", ["Switch Session"])
send("\x1b")
time.sleep(0.5)

send("hello from pty-test6")
send("\r")
check("echo back", ["hello from pty-test6"], timeout=15)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print("=== FINAL FRAME ===")
print(term.frame()[:1500])
print("=== EXIT ===")
