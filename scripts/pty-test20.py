#!/usr/bin/env python3
"""PTY 测试 v20：工具轮（多 assistant 卡片）重启后 reasoning part 必须有 time.end。

回归场景（用户报：部分思考过程 live 正常显示 Thought，退出重进后变 Thinking 转圈）：
live 路径每轮只有一个 pending，turn/end 统一推 time.end；但 hydrate 路径
projection 对工具轮产生多条 assistant 卡片，旧代码 turn/end 只标记最后一条，
中间卡片的 endedAt 缺失 → 重启后 reasoning part 无 time.end → fork 的
ReasoningPart.isDone() 为 false → 显示 Thinking 转圈。

断言（权威数据源 = 会话文件 + 兼容层 HTTP，不用屏幕文本）：
1. boot1：发工具调用 prompt → 会话文件出现 turn/end 且 ≥2 条 assistant/message
   （多 assistant 卡片结构成立）。
2. kill 整个进程组（防孤儿占端口）→ boot2 重启触发 hydrate。
3. GET /session/:id/message：存在 reasoning part 且全部有 time.end。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, json, shutil, signal, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 43121
BASE = f"http://127.0.0.1:{PORT}"
ENV_BASE = dict(os.environ)
ENV_BASE["NODE_ENV"] = "production"
ENV_BASE["COLORTERM"] = "truecolor"
ENV_BASE["TERM"] = "xterm-256color"
ENV_BASE["DSH_HOME"] = os.path.join(ROOT, ".dsh-home")
ENV_BASE["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
ENV_BASE["DSH_OPENCODE_TUI_SERVER_PORT"] = str(PORT)
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
    ENV_BASE[k] = os.path.join(ROOT, ".xdg-" + k[-6:])
    os.makedirs(ENV_BASE[k], exist_ok=True)

PAT = rb'(\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_G[^\x1b]*\x1b\\|\x1bP[^\x1b]*\x1b\\|\x1b[c=>()0-9A-FM78]|\x1b[78])'

def find_session_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn == "session.jsonl.zstd":
                out.append(os.path.join(dirpath, fn))
    out.sort(key=lambda f: os.path.getmtime(f))
    return out

def session_events(root):
    files = find_session_files(root)
    if not files:
        return []
    data = subprocess.run(["zstd", "-d", "-c", files[-1]], capture_output=True).stdout.decode("utf-8", "replace")
    out = []
    for line in data.splitlines():
        try:
            e = json.loads(line)
        except Exception:
            continue
        if isinstance(e, dict) and "type" in e:
            out.append(e)
    return out

def http_json(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))

def boot(round_no):
    errf = open(f"t20-{round_no}-err.log", "wb")
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
    proc = subprocess.Popen(["dsh", "--profile", "dsh-opencode-tui"], cwd=ROOT, env=ENV_BASE,
        stdin=slave, stdout=slave, stderr=errf, close_fds=True, start_new_session=True)
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
    def send(s, delay=0.4):
        os.write(master, s.encode() if isinstance(s, str) else s)
        time.sleep(delay)
    def kill():
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
        errf.close()
    return master, proc, drain, send, kill

# ── boot1：跑一个真实工具轮（思考 + bash 工具 + 最终回复 → 多条 assistant 卡片）──
for d in os.listdir(os.path.join(ROOT, ".oc-sessions")):
    shutil.rmtree(os.path.join(ROOT, ".oc-sessions", d))

master, proc, drain, send, kill = boot(1)
drain(15)
PROMPT = "run the shell command `echo TOOLCALL-OK-42` and then reply with exactly the output"
send(PROMPT)
send("\r")
deadline = time.time() + 180
multi = False
while time.time() < deadline:
    drain(1)
    events = session_events(ROOT)
    if events:
        types = [e["type"] for e in events]
        if "turn/end" in types and types.count("assistant/message") >= 2:
            multi = True
            break
time.sleep(4)
types = [e["type"] for e in session_events(ROOT)]
print("boot1 tool turn complete (turn/end):", "turn/end" in types, flush=True)
print("boot1 assistant/message count:", types.count("assistant/message"), "(need >=2, multi-card)", flush=True)
kill()
time.sleep(2)

# ── boot2：重启 → hydrate（此时端口必须空闲，孤儿进程会导致假 PASS）──
master, proc, drain, send, kill = boot(2)
drain(20)
hydrated = False
for _ in range(30):
    try:
        sessions = http_json("/session")
        if sessions:
            hydrated = True
            break
    except Exception:
        pass
    drain(1)
print("boot2 hydrated (fresh server, GET /session non-empty):", hydrated, flush=True)
reasoning_total = 0
reasoning_missing = 0
if hydrated:
    sid = sessions[0]["id"]
    msgs = http_json(f"/session/{sid}/message")
    reasoning_parts = [
        (m.get("info", {}).get("id"), p)
        for m in msgs
        for p in m.get("parts", [])
        if p.get("type") == "reasoning"
    ]
    reasoning_total = len(reasoning_parts)
    no_end = [(mid, p.get("text", "")[:40]) for mid, p in reasoning_parts if p.get("time", {}).get("end") is None]
    reasoning_missing = len(no_end)
    print(f"reasoning parts after restart: {reasoning_total}", flush=True)
    print("reasoning parts missing time.end:", reasoning_missing, flush=True)
    if no_end:
        print("MISSING:", json.dumps(no_end, ensure_ascii=False)[:300], flush=True)
kill()

# 结构要求：工具轮必须成立（多卡片）+ 重启后所有 reasoning part 有 time.end
ok = multi and hydrated and reasoning_total >= 1 and reasoning_missing == 0
print("PASS" if ok else "FAIL", flush=True)
