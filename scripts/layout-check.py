#!/usr/bin/env python3
"""验证 home 布局垂直居中：解析 Logo/Prompt 文本出现的行号。"""
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
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV[k], exist_ok=True)

errf = open("test-layout-err.log", "wb")
COLS, ROWS = 120, 36
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=errf, close_fds=True)
os.close(slave)
resp = TermResponder(master, threaded=False)

# 解析流：维护当前光标行，遇到 CSI <r>;<c>H 更新；文本块记录其行
row = 1
logo_rows = []
ask_rows = []
buf = b""
end = time.time() + 18
while time.time() < end:
    r, _, _ = select.select([master], [], [], 0.2)
    if not r:
        continue
    try:
        d = os.read(master, 65536)
    except OSError:
        break
    if not d:
        break
    buf += d
    # 应答
    reps = resp.feed_sync(d)
    if reps:
        try:
            os.write(master, reps)
        except OSError:
            pass
    # 解析最近一段：找 CSI H 定位 + 文本
    text = d.decode("utf-8", "replace")
    for m in re.finditer(r"\x1b\[(\d+);(\d+)H", text):
        row = int(m.group(1))
    # 提取定位后的文本（粗略：按 H 序列切分，取每段的首个可见块）
    segs = re.split(r"\x1b\[(\d+);(\d+)H", text)
    # segs: [before, r1, c1, after1, r2, c2, after2, ...]
    for i in range(1, len(segs) - 1, 3):
        r = int(segs[i])
        chunk = segs[i + 2]
        if "█▀▀█" in chunk and r not in logo_rows:
            logo_rows.append(r)
        if "Ask anything" in chunk and r not in ask_rows:
            ask_rows.append(r)

print(f"ROWS={ROWS}")
print(f"Logo rows: {logo_rows}")
print(f"Ask anything rows: {ask_rows}")
mid = ROWS / 2
ok = bool(logo_rows) and all(4 <= r <= ROWS - 6 for r in logo_rows)
print(f"Logo 垂直居中(中部区域 4..{ROWS-6}): {'PASS' if ok else 'FAIL'}")
print(f"Ask 行 {ask_rows} 应在 Logo 之下: {'PASS' if ask_rows and logo_rows and ask_rows[0] > logo_rows[0] else 'FAIL'}")

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
