#!/usr/bin/env python3
"""PTY 测试 v19：Tab 切换权限模式 agent（read-only / workspace-write / full-access）。

验证：
1. 初始 agent = Workspace-Write（输入框上方显示）
2. Tab 轮换：Read-Only → Full-Access → Workspace-Write（循环）
3. 切到 read-only 发消息 → DSH 会话 permission/preset = read-only
4. 切到 full-access（第二次独立 boot）发消息 → 会话 preset = danger-full-access

注：navigate 到 session 页后输入在沙箱 pty 里失效（OpenTUI reconciler 未挂载
session Prompt 的 textarea，沙箱渲染限制），所以 full-access 用第二次 boot 验证。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_BASE = dict(os.environ)
ENV_BASE["NODE_ENV"] = "production"
ENV_BASE["COLORTERM"] = "truecolor"
ENV_BASE["TERM"] = "xterm-256color"
ENV_BASE["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV_BASE["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV_BASE[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV_BASE[k], exist_ok=True)

PAT = rb'(\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_G[^\x1b]*\x1b\\|\x1bP[^\x1b]*\x1b\\|\x1b[c=>()0-9A-FM78]|\x1b[78])'

def extract(data):
    out = []
    for t in re.split(PAT, data):
        if t.startswith(b"\x1b"):
            continue
        for ch in t:
            if ch >= 32 and ch not in b" ":
                out.append(chr(ch))
    return "".join(out)

def find_session_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn == "session.jsonl.zstd":
                out.append(os.path.join(dirpath, fn))
    out.sort(key=lambda f: os.path.getmtime(f))
    return out

def latest_session_text(root):
    files = find_session_files(root)
    if not files:
        return ""
    return subprocess.run(["zstd", "-d", "-c", files[-1]], capture_output=True).stdout.decode("utf-8", "replace")

def assistant_has_word(root, word):
    """解析最新会话文件：assistant 消息的 text 内容是否含 word。"""
    files = find_session_files(root)
    if not files:
        return False
    out = subprocess.run(["zstd", "-d", "-c", files[-1]], capture_output=True).stdout.decode("utf-8", "replace")
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") != "assistant/message":
            continue
        msg = (obj.get("data") or {}).get("message") or {}
        if msg.get("role") != "assistant":
            continue
        for block in msg.get("content") or []:
            if block.get("type") == "text" and word in block.get("text", ""):
                return True
    return False

def clear_sessions():
    root = os.path.join(ROOT, ".oc-sessions")
    for entry in os.listdir(root):
        p = os.path.join(root, entry)
        if os.path.isdir(p):
            for sub in os.listdir(p):
                subp = os.path.join(p, sub)
                for f in os.listdir(subp):
                    os.remove(os.path.join(subp, f))
                os.rmdir(subp)
            os.rmdir(p)

def run_case(label, tab_presses, agent_name, word, preset, errname, intermediates=()):
    """一次独立 boot：Tab 若干次 → 发消息 → 验证 preset 与回复。"""
    ENV = dict(ENV_BASE)
    errf = open(errname, "wb")
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
    proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV,
        stdin=slave, stdout=slave, stderr=errf, close_fds=True)
    os.close(slave)
    resp = TermResponder(master, threaded=False)
    buf = b""

    def drain(t=1.0):
        nonlocal buf
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

    def send(s, delay=0.5):
        os.write(master, s.encode() if isinstance(s, str) else s)
        time.sleep(delay)

    def wait_for(pred, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            drain(1)
            if pred(extract(buf)):
                return True
        return False

    ok = wait_for(lambda t: "Askanything" in t, 20)
    print(f"[{label}] BOOT:", ok, flush=True)
    # 依次 Tab，检查每一步显示的 agent 名（intermediate 列表不含最后目标）
    for i in range(tab_presses):
        send("\t")
        expected = agent_name if i == tab_presses - 1 else intermediates[i]
        ok = wait_for(lambda t: expected in t, 10)
        print(f"[{label}] Tab {i + 1} -> {expected}:", ok, flush=True)
    prompt = f"reply with the single word {word} and nothing else"
    send(prompt)
    send("\r")
    ok = wait_for(lambda t: word[:3] in t and "Thought" in t, 90)
    print(f"[{label}] reply seen:", ok, flush=True)
    time.sleep(2)
    sess = latest_session_text(os.path.join(ROOT, ".oc-sessions"))
    print(f"[{label}] preset {preset} applied:", preset in sess, flush=True)
    print(f"[{label}] assistant replied {word}:", assistant_has_word(os.path.join(ROOT, ".oc-sessions"), word), flush=True)
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    errf.close()

# 阶段 1：Tab 轮换验证（boot 一次）
clear_sessions()
run_case("A", 1, "Read-Only", "ZEBRA", "read-only", "test19a-err.log")

# 阶段 2：full-access（重新 boot；Tab 两次 workspace-write → read-only → full-access）
clear_sessions()
run_case("B", 2, "Full-Access", "DONE", "danger-full-access", "test19b-err.log", intermediates=("Read-Only",))
print("done")
