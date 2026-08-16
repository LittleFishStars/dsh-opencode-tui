#!/usr/bin/env python3
"""PTY 测试 v21：侧边栏内容渲染（Context/Todo/Modified Files）。

回归场景（用户报：侧边栏还是什么都没有）：
fork CLI 的 pluginHost 是空实现 → 注册 sidebar_content slot 的内置插件
（Context/Todo/Files/Mcp/Lsp/Footer）从未被加载 → 侧边栏只有标题框，内容全空。

修复：fork packages/cli/src/tui.ts 实现最小 plugin host，加载 createBuiltinPlugins。

断言（屏幕文本；宽终端 140 列让 sidebarVisible 为 true）：
1. 会话页出现 "Context" 区（无条件渲染，含 tokens/percent/spent）。
2. 发消息后 tokens 明细（"out" "cached"）出现。
3. write 工具调用 → "Modified Files" 区出现。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, json, shutil, signal

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

def session_text(root):
    files = find_session_files(root)
    if not files:
        return ""
    return subprocess.run(["zstd", "-d", "-c", files[-1]], capture_output=True).stdout.decode("utf-8", "replace")

for d in os.listdir(os.path.join(ROOT, ".oc-sessions")):
    shutil.rmtree(os.path.join(ROOT, ".oc-sessions", d))

errf = open("t21-err.log", "wb")
COLS, ROWS = 140, 40
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV_BASE,
    stdin=slave, stdout=slave, stderr=errf, close_fds=True, start_new_session=True)
os.close(slave)
resp = TermResponder(master, threaded=False)

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

def kill():
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except Exception:
        pass
    errf.close()

drain(15)
t = extract(buf)
print("BOOT OK:", "Askanything" in t or "agents" in t or "Context" in t, flush=True)
print("boot screen has Context:", "Context" in t, flush=True)

# 发消息（产生 tokens → Context 明细）
PROMPT = "reply with the single word ZEBRA and nothing else"
send(PROMPT)
send("\r")
deadline = time.time() + 120
while time.time() < deadline:
    drain(1)
    t = extract(buf)
    if "ZEBRA" in t:
        break
time.sleep(3)
t = extract(buf)
print("reply rendered:", "ZEBRA" in t, flush=True)
print("Context section:", "Context" in t, flush=True)
print("tokens line:", "tokens" in t, flush=True)
print("out detail:", "out" in t and "cached" in t, flush=True)
print("spent line:", "spent" in t, flush=True)

# 工具调用轮 → Modified Files（write 工具）
PROMPT2 = "write the file scripts/sidebar-test.txt with content SIDEBAR-FILE-OK and reply DONE"
send(PROMPT2)
send("\r")
deadline = time.time() + 150
while time.time() < deadline:
    drain(1)
    if "DONE" in extract(buf):
        break
time.sleep(4)
t = extract(buf)
print("tool reply rendered:", "DONE" in t, flush=True)
print("Modified Files section:", "ModifiedFiles" in t, flush=True)
print("file shown:", "sidebar-test.txt" in t.replace("scripts/sidebar-test.txt", "sidebar-test.txt") or "SIDEBAR" in t, flush=True)
kill()
print("done")
