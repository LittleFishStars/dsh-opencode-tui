#!/usr/bin/env python3
"""PTY 测试 v22：会话删除（DELETE /session/:id）。

回归场景（用户报：会话列表删除失败 "Failed to delete session / no route:
DELETE /session/ses_..."）——兼容层没有 DELETE 路由。

验证：
1. boot TUI（固定端口）→ 发一条消息（产生 DSH 会话 + 磁盘工件）。
2. HTTP DELETE /session/<id> → 200。
3. GET /session 不再包含该会话。
4. session.deleted SSE 事件已推送（oc-server.log 有 deleted 记录）。
5. DSH 磁盘工件已删除（.oc-sessions 下无该会话文件）。
"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, json, shutil, signal, urllib.request, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from term_responder import TermResponder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 43122
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

def session_text(root):
    files = find_session_files(root)
    if not files:
        return ""
    return subprocess.run(["zstd", "-d", "-c", files[-1]], capture_output=True).stdout.decode("utf-8", "replace")

def http_json(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, json.loads(r.read().decode("utf-8"))

for d in os.listdir(os.path.join(ROOT, ".oc-sessions")):
    shutil.rmtree(os.path.join(ROOT, ".oc-sessions", d))

errf = open("t22-err.log", "wb")
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
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
PROMPT = "reply with the single word ZEBRA and nothing else"
send(PROMPT)
send("\r")
deadline = time.time() + 120
while time.time() < deadline:
    drain(1)
    if "turn/end" in session_text(ROOT):
        break
time.sleep(3)
files_before = find_session_files(ROOT)
print("session created:", len(files_before) > 0, flush=True)
if not files_before:
    print("FAIL (no session created)", flush=True)
    kill()
    sys.exit(1)

# 通过兼容层找 opencode 会话 id
deadline = time.time() + 15
sessions = []
while time.time() < deadline:
    try:
        st, sessions = http_json("/session")
        if sessions:
            break
    except Exception:
        pass
    drain(1)
print("GET /session count:", len(sessions), flush=True)
sid = sessions[0]["id"] if sessions else None
print("session id:", sid, flush=True)

# 删除
st, body = http_json(f"/session/{sid}", method="DELETE")
print("DELETE status:", st, "body:", body, flush=True)

# 会话从列表消失
st, sessions = http_json("/session")
print("after delete, GET /session count:", len(sessions), flush=True)
print("deleted id gone from list:", not any(s["id"] == sid for s in sessions), flush=True)

# 磁盘工件删除（.oc-sessions 递归扫描）
files_after = find_session_files(ROOT)
print("disk artifacts before:", len(files_before), "after:", len(files_after), flush=True)

# 日志有 deleted 记录
log = ""
try:
    with open(os.path.join(ROOT, ".dsh-home", "logs", "oc-server.log"), "r", encoding="utf-8", errors="replace") as f:
        log = f.read()
except Exception:
    pass
print("log has deleted:", "deleted session" in log, flush=True)

ok = (st == 200 and not any(s["id"] == sid for s in sessions)
      and len(files_after) < len(files_before) and "deleted session" in log)
print("PASS" if ok else "FAIL", flush=True)
kill()
