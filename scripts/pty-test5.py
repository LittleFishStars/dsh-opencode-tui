#!/usr/bin/env python3
"""PTY 测试 v5：opencode fork + DSH 桥端到端回归。

流程：启动（跳过 init 对话框）→ 发送消息（触发工具调用）→ 验证
thinking 折叠 / 工具调用 / 回复渲染 → 会话对话框 → 退出。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from miniterm import MiniTerm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CWD = ROOT
ENV = dict(os.environ)
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["XDG_CONFIG_HOME"] = os.path.join(ROOT, ".xdg-config")
ENV["XDG_DATA_HOME"] = os.path.join(ROOT, ".xdg-data")

COLS, ROWS = 110, 32
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=CWD, env=ENV,
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
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
    print(term.frame()[:800])
    return False

drain(10)
if "Initialize Project" in term.frame():
    send("\t")
    send("\r")
    drain(1.5)

check("boot", ["⌬", "OpenCode"])

# 1) 发送触发工具调用的消息
send("create a file named go-test.txt containing the word GOBRIDGE, then run `cat go-test.txt` and report")
send("\r")
check("tool call", ["bash", "Bash", "cat"], timeout=120)
check("reply content", ["GOBRIDGE"], timeout=60)
drain(1)
print("=== AFTER TOOL REPLY ===")
print(term.frame()[:1500])

# 2) 会话对话框（ctrl+s）
send("\x13")
check("sessions dialog", ["Switch Session"])
send("\x1b")
time.sleep(0.5)

# 3) 退出（opencode 的 quit 对话框默认选 No，需 Tab 切到 Yes 再 Enter）
send("\x03")
time.sleep(0.5)
check("quit dialog", ["sure"])
send("\t")
time.sleep(0.3)
send("\r")
time.sleep(3)
rc = proc.poll()
print("=== EXIT rc:", rc, "===")
if rc is None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
