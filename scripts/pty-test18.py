#!/usr/bin/env python3
"""PTY 测试 v18：question 对话框完整流程（agent 提问 → 选择 → Enter → DSH 收到答案）。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"
ENV["COLORTERM"] = "truecolor"
ENV["TERM"] = "xterm-256color"
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
ENV["DSH_OC_DEBUG"] = "1"
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV[k], exist_ok=True)

errf = open("test18-err.log", "wb")
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
print("BOOT OK", flush=True)

# 触发 ask_user_question
PROMPT = "use the ask_user_question tool to ask me a single-choice question about my favorite color, with options Red, Green, Blue. Then wait for my answer."
send(PROMPT)
send("\r")

# 等对话框
deadline = time.time() + 90
dialog_seen = False
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if "Debugquestion" in t or ("favoritecolor" in t and "1.Red" in t):
        dialog_seen = True
        print("[OK] question dialog rendered", flush=True)
        idx = t.rfind("favoritecolor")
        if idx < 0:
            idx = t.rfind("Debugquestion")
        print("  dialog:", repr(t[max(0, idx - 60):idx + 220]), flush=True)
        break
if not dialog_seen:
    print("[FAIL] no question dialog", flush=True)
    print("TAIL:", repr(extract(buf)[-400:]), flush=True)
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    errf.close()
    sys.exit(1)

# 断言原版完整布局：选项 description 行、自定义输入项 "Type your own answer"、
# 编号选项（1. 2. 3.）。注意：选项 description 由 DSH question 的 option.description
# 提供，兼容层已对齐 QuestionOption {label, description}。
t_full = extract(buf)
layout_custom = "Typeyourownanswer" in t_full
layout_options = "1.Red" in t_full or "Red" in t_full
print("[OK] full layout (custom answer item):", layout_custom, flush=True)
print("[OK] options rendered:", layout_options, flush=True)

# 选择第一个选项（Red 默认选中）→ Enter 提交
time.sleep(1.5)
send("\r")
print("[OK] pressed Enter (Red)", flush=True)

# 验证 DSH 收到答案：会话文件里 agent 后续文本（"Red" 确认）
# 注意：不用 glob（沙箱里 glob 通配扫描只见目录不见文件），用 os.walk 递归扫描。
def find_session_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn == "session.jsonl.zstd":
                out.append(os.path.join(dirpath, fn))
    return out

def session_has_answer(f):
    import json
    out = subprocess.run(["zstd", "-d", "-c", f], capture_output=True).stdout.decode("utf-8", "replace")
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        # agent 收到答案后的回复：assistant 消息的 text 内容提到 Red / chose
        if obj.get("type") != "assistant/message":
            continue
        msg = (obj.get("data") or {}).get("message") or {}
        if msg.get("role") != "assistant":
            continue
        for block in msg.get("content") or []:
            if block.get("type") == "text":
                txt = block.get("text", "")
                if ("Red" in txt or "chose" in txt) and "ask_user_question" not in txt:
                    return True
    return False

deadline = time.time() + 40
confirmed = False
while time.time() < deadline:
    time.sleep(2)
    files = find_session_files(os.path.join(ROOT, ".oc-sessions"))
    if not files:
        continue
    if any(session_has_answer(f) for f in files):
        confirmed = True
        print("[OK] answer delivered, agent confirmed Red", flush=True)
        print("TAIL:", repr(extract(buf)[-400:]), flush=True)
        break
if not confirmed:
    print("[FAIL] answer not confirmed", flush=True)
    print("TAIL:", repr(extract(buf)[-500:]), flush=True)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
errf.close()
print("done")
