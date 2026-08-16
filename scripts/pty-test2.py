#!/usr/bin/env python3
"""扩展 PTY 测试：resume、对话框、主题、第二轮对话。"""
import os, pty, select, sys, time, signal, subprocess, re, fcntl, termios, struct, glob

CWD = "/home/ylxc/Projects/DSH/dsh-opencode-tui"
ENV = dict(os.environ)
ENV["DSH_HOME"] = os.path.join(CWD, ".dsh-home")
ENV["NODE_ENV"] = "production"

# 找已有会话
sessions = glob.glob(os.path.join(CWD, ".dsh-home", "sessions", "*", "*", "session.jsonl.zstd"))
resume_id = None
if sessions:
    m = re.search(r"session-([0-9a-f-]+)", sessions[0])
    if m:
        resume_id = "session-" + m.group(1)
print("RESUME_ID:", resume_id)

master, slave = pty.openpty()
# 设置窗口大小 120x36
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))

proc = subprocess.Popen(
    ["dsh", "--profile", "opencode"] + (["--resume", resume_id] if resume_id else []),
    cwd=CWD, env=ENV, stdin=slave, stdout=slave, stderr=slave, close_fds=True,
)
os.close(slave)
output = bytearray()

def drain(timeout=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r, _, _ = select.select([master], [], [], 0.1)
        if not r:
            continue
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        output.extend(data)

def send(s):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(0.4)

def snapshot():
    text = output.decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", text)
    clean = re.sub(r"\x1b\][^\x07]*\x07", "", clean)
    clean = re.sub(r"\x1b[()][0-9A-B]", "", clean)
    lines = clean.split("\r\n") if "\r\n" in clean else clean.split("\n")
    return "\n".join(lines[-45:])

def check(label, needles, timeout=5):
    """等待某个文本出现。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(0.5)
        t = snapshot()
        for n in needles:
            if n in t:
                print(f"[OK] {label}: found {n!r}")
                return True
    print(f"[FAIL] {label}: none of {needles} found")
    print(snapshot())
    return False

drain(8)
print("=== BOOT (resume) ===")
print(snapshot())

# 1. 会话对话框
send("\x13")  # ctrl+s
check("sessions dialog", ["Sessions", "filter..."])
send("\x1b")  # esc
time.sleep(0.5)

# 2. 命令对话框
send("\x0b")  # ctrl+k
check("commands dialog", ["Commands", "New Session"])
send("\x1b")
time.sleep(0.5)

# 3. 帮助
send("\x08")  # ctrl+h
check("help dialog", ["Help", "ctrl+c"])
send("\x1b")
time.sleep(0.5)

# 4. 主题
send("\x14")  # ctrl+t
check("theme dialog", ["Theme", "opencode"])
send("d")  # 选 dracula? 需要先过滤 —— 直接 enter 选第一个
send("\r")
time.sleep(0.5)

# 5. 发一条消息
send("what is 2+2? answer with just the number")
send("\r")
check("assistant reply", ["2+2", "deepseek", "•", "─"], timeout=90)

# 6. 新会话
send("\x0e")  # ctrl+n
time.sleep(1)
print("=== AFTER CTRL+N ===")
print(snapshot())

# 7. 退出
send("\x03")
time.sleep(0.5)
send("\r")
time.sleep(2)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
with open(os.path.join(CWD, ".dsh-home", "pty-test2.log"), "w") as f:
    f.write(output.decode("utf-8", "replace"))
print("=== EXIT rc:", proc.returncode, "===")
print("done")
