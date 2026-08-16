#!/usr/bin/env python3
"""PTY 验证：ReasoningHeader 的 "Thought" 是否完整渲染（前导空格方案）。

检查 extract 输出中：
- "Thought" 完整出现 → PASS（"Th" 不再被吞）
- 只有 "+ought" 无 "Thought" → FAIL（前导空格方案无效）
"""
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

errf = open("verify-thought-err.log", "wb")
COLS, ROWS = 120, 36
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV,
    stdin=slave, stdout=slave, stderr=errf, close_fds=True)
os.close(slave)
resp = TermResponder(master, threaded=False)

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
        replies = resp.feed_sync(d)
        if replies:
            try:
                os.write(master, replies)
            except OSError:
                pass

def send(s, delay=0.4):
    os.write(master, s.encode() if isinstance(s, str) else s)
    time.sleep(delay)

drain(15)
print("BOOT OK:", "Ask anything" in extract(buf) or "agents" in extract(buf), flush=True)

PROMPT = "reply with the single word ZEBRA and nothing else"
send(PROMPT)
send("\r")
deadline = time.time() + 90
sent_ok = False
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if not sent_ok:
        if PROMPT not in t:
            sent_ok = True
            print("[OK] prompt submitted, input cleared", flush=True)
        continue
    if "ZEBRA" in t and "reply with the single word" not in t[-1500:]:
        print("[OK] assistant reply rendered: ZEBRA", flush=True)
        # 再等 2s 让完整画面稳定（完成态渲染）
        drain(2)
        break
else:
    t = extract(buf)
    print("[FAIL] no assistant reply", flush=True)
    print("TAIL:", repr(t[-800:]), flush=True)

t = extract(buf)
full = t.count("Thought")
broken = t.count("+ought")
print(f"[CHECK] full 'Thought' occurrences: {full}, '+ought' occurrences: {broken}", flush=True)
if full > 0:
    print("[PASS] Thought renders completely", flush=True)
elif broken > 0:
    print("[FAIL] still broken: only +ought", flush=True)
else:
    print("[INFO] neither found (no reasoning shown?)", flush=True)
print("TAIL:", repr(t[-600:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
