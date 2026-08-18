#!/usr/bin/env python3
"""端到端测试：创建会话 → 发消息 → 列表 → 加载内容。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, shutil, signal, json, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"; ENV["COLORTERM"] = "truecolor"; ENV["TERM"] = "xterm-256color"
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home"); ENV["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
for k in ("XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_STATE_HOME","XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:]); os.makedirs(ENV[k], exist_ok=True)
for d in os.listdir(os.path.join(ROOT, ".oc-sessions")):
    shutil.rmtree(os.path.join(ROOT, ".oc-sessions", d))

errf = open("test-flow-err.log","wb")
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
proc = subprocess.Popen(["dsh","--profile","dsh-opencode-tui"], cwd=ROOT, env=ENV, stdin=slave, stdout=slave, stderr=errf, close_fds=True, start_new_session=True)
os.close(slave)

def req(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    r.add_header("Content-Type", "application/json")
    return json.loads(urllib.request.urlopen(r, timeout=10).read().decode())

time.sleep(10)
logf = os.path.join(ROOT, ".dsh-home", "logs", "oc-server.log")
port = None
for line in open(logf):
    m = re.search(r"listening on http://127.0.0.1:(\d+)", line)
    if m: port = m.group(1)
print("port:", port)

# 1. 创建会话
sid = req("POST", "/session").get("id")
print("1. created session:", sid)

# 2. 发消息（触发 DSH agent 创建持久化会话文件）
try:
    req("POST", f"/session/{sid}/message", {"parts": [{"type": "text", "text": "reply with ZEBRA"}]})
    print("2. message sent")
except Exception as e:
    print("2. message err:", str(e)[:50])

# 3. 等 DSH agent 处理 + 持久化
time.sleep(10)

# 4. GET /session 看列表
data = req("GET", "/session?roots=true&limit=100&scope=project")
print(f"3. GET /session: {len(data)} sessions")
for it in data[:3]:
    print(f"   id={it.get('id','?')[:12]} title={repr(it.get('title','?'))}")

# 5. GET /session/:id/message 看内容
if data:
    oid = data[0].get("id")
    msgs = req("GET", f"/session/{oid}/message")
    print(f"4. GET /session/{oid[:12]}/message: {len(msgs)} messages")
    for m in msgs[:3]:
        role = m.get("role", "?")
        text = str(m.get("parts", [{}])[0].get("text", ""))[:40] if m.get("parts") else ""
        print(f"   role={role} text={repr(text)}")

# 6. 看日志
print("=== hydrate logs ===")
for line in open(logf):
    if "hydrate" in line.lower() or "hydrateOnDemand" in line:
        print(" ", line.strip()[:120])

try:
    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
except Exception: pass
try: proc.wait(timeout=5)
except Exception: pass
errf.close()
