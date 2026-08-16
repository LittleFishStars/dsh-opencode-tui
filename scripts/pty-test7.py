#!/usr/bin/env python3
"""PTY 测试 v7：官方预编译 opencode-ai 二进制，raw 输出落盘 + term_responder 应答。

把 pty 原始字节流写入 raw.bin，供 xterm-headless 重放得到真实屏幕。
"""
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
OUT = os.path.join(ROOT, "raw6.bin")

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen([BIN], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
resp = TermResponder(master)

with open(OUT, "wb") as f:
    def drain(t=1.0):
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([master], [], [], 0.2)
            if not r:
                continue
            try:
                data = os.read(master, 65536)
            except OSError:
                return
            if not data:
                return
            f.write(data)
            f.flush()

    drain(50)          # 启动
    os.write(master, b"hi from v7")   # 输入
    time.sleep(0.3)
    os.write(master, b"\r")
    drain(20)          # 等待回复（无 LLM，观察错误呈现）

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
print(f"captured {os.path.getsize(OUT)} bytes -> {OUT}")
