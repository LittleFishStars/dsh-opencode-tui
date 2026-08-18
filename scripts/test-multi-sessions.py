#!/usr/bin/env python3
"""测试多会话场景：创建 5 个会话，看列表和加载是否正常。"""
import os, pty, select, time, subprocess, fcntl, termios, struct, sys, re, shutil, signal, json, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ)
ENV["NODE_ENV"] = "production"; ENV["COLORTERM"] = "truecolor"; ENV["TERM"] = "xterm-256color"
ENV["DSH_HOME"] = os.path.join(ROOT, ".dsh-home"); ENV["DSH_OPENCODE_SESSION_ROOT"] = os.path.join(ROOT, ".oc-sessions")
for k in ("XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_STATE_HOME","XDG_CACHE_HOME"):
    ENV[k] = os.path.join(ROOT, ".xdg-" + k[-6:]); os.makedirs(ENV[k], exist_ok=True)
for d in os.listdir(os.path.join(ROOT, ".oc-sessions")):
    shutil.rmtree(os.path.join(ROOT, ".oc-sessions", d))

errf = open("test-multi-err.log","wb")
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
proc = subprocess.Popen(["dsh","--profile","dsh-opencode-tui"], cwd=ROOT, env=ENV, stdin=slave, stdout=slave, stderr=errf, close_fds=True, start_new_session=True)
os.close(slave)

def req(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    r.add_header("Content-Type", "application/json")
    return json.loads(urllib.request.urlopen(r, timeout=30).read().decode())

time.sleep(10)
logf = os.path.join(ROOT, ".dsh-home", "logs", "oc-server.log")
port = None
for line in open(logf):
    m = re.search(r"listening on http://127.0.0.1:(\d+)", line)
    if m: port = m.group(1)
print("port:", port)

# 创建 3 个会话
sids = []
for i in range(3):
    sid = req("POST", "/session").get("id")
    sids.append(sid)
    print(f"created {i+1}: {sid[:12]}")
    try:
        req("POST", f"/session/{sid}/message", {"parts": [{"type": "text", "text": f"message {i+1}"}]})
    except Exception as e:
        print(f"  msg err: {str(e)[:40]}")

time.sleep(15)

# 列表
data = req("GET", "/session?roots=true&limit=100&scope=project")
print(f"\nGET /session: {len(data)} sessions")
for it in data:
    print(f"  id={it.get('id','?')[:12]} title={repr(it.get('title','?'))[:30]}")

# 加载每个会话的内容
for it in data:
    oid = it.get("id")
    msgs = req("GET", f"/session/{oid}/message")
    print(f"  {oid[:12]}: {len(msgs)} messages")

try:
    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
except Exception: pass
try: proc.wait(timeout=5)
except Exception: pass
errf.close()
