#!/usr/bin/env python3
"""受控 PTY 测试：启动 TUI，喂按键，收集输出，验证交互。"""
import os, pty, select, sys, time, signal, subprocess, json

CWD = "/home/ylxc/Projects/DSH/dsh-opencode-tui"
ENV = dict(os.environ)
ENV["DSH_HOME"] = os.path.join(CWD, ".dsh-home")
ENV["NODE_ENV"] = "production"

master, slave = pty.openpty()
proc = subprocess.Popen(
    ["dsh", "--profile", "opencode"],
    cwd=CWD,
    env=ENV,
    stdin=slave,
    stdout=slave,
    stderr=slave,
    close_fds=True,
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
    time.sleep(0.3)

def frame():
    return output.decode("utf-8", "replace")

def snapshot():
    """当前屏幕最后一帧：取最后 N 字节中的可读文本。"""
    text = frame()
    # 去掉转义序列
    import re
    clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", text)
    clean = re.sub(r"\x1b\][^\x07]*\x07", "", clean)
    clean = clean.replace("\x1b[?1049h", "").replace("\x1b[?1049l", "")
    lines = clean.split("\r\n") if "\r\n" in clean else clean.split("\n")
    # 最后 40 行
    return "\n".join(lines[-40:])

# 1. 等待启动
drain(8)
print("=== BOOT ===")
print(snapshot())

# 2. 输入消息 + 回车
send("reply with exactly the single word: ok")
drain(1)
print("=== AFTER TYPING ===")
print(snapshot())
send("\r")
drain(2)
print("=== AFTER ENTER ===")
print(snapshot())

# 3. 等待 agent 回复（最多 60s）
deadline = time.time() + 60
while time.time() < deadline:
    drain(1.0)
    t = frame()
    if "Waiting" in t or "⠋" in t or "ok" in t:
        pass
    if "turn/end" in t:
        break
    if time.time() > deadline - 30 and "deepseek" in t:
        break

print("=== AFTER WAIT ===")
print(snapshot())

# 4. 截图当前状态供人工检查
with open(os.path.join(CWD, ".dsh-home", "pty-test.log"), "w") as f:
    f.write(frame())

# 5. Ctrl+C → 退出对话框 → 回车确认
send("\x03")
drain(1)
print("=== AFTER CTRL+C ===")
print(snapshot())
send("\r")
drain(3)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
print("=== EXIT ===")
print("rc:", proc.returncode)
print("done")
