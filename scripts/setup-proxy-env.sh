#!/usr/bin/env bash
# 重建测试环境：fork serve(4102) + record-server(4199, 代理+记录) + 伪造注册 server.json
# 用法: bash scripts/setup-proxy-env.sh [--fresh]
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

if [ "$1" = "--fresh" ]; then
  rm -rf .xdg-serveA .xdg-state9 .xdg-data9
fi
mkdir -p .xdg-serveA .xdg-state9/opencode .xdg-data9

# 清理旧进程（精确进程名，避免误杀）
for P in $(ps aux | awk '$11 ~ /lildax/ && $12 == "serve" {print $2}'); do kill -9 $P 2>/dev/null || true; done
for P in $(ps aux | grep "scripts/record-server.cjs" | grep -v grep | awk '{print $2}'); do kill -9 $P 2>/dev/null || true; done
sleep 1

LILDAX="$ROOT/opencode-fork/packages/cli/dist/cli-linux-x64/bin/lildax"

# fork serve（真实后端，供代理抓响应）
XDG_CONFIG_HOME="$ROOT/.xdg-serveA" XDG_DATA_HOME="$ROOT/.xdg-serveA" \
XDG_STATE_HOME="$ROOT/.xdg-serveA" XDG_CACHE_HOME="$ROOT/.xdg-cache6" \
  "$LILDAX" serve --port 4102 > serveA.log 2>&1 &
sleep 4
[ -f "$ROOT/.xdg-serveA/opencode/password" ] || { echo "serve failed to start"; exit 1; }
PASS="$(cat "$ROOT/.xdg-serveA/opencode/password")"

# record-server（代理+记录+mock）
echo '{}' > research/mock2.json
RECORD_PROXY=http://127.0.0.1:4102 RECORD_PROXY_AUTH="opencode:$PASS" \
RECORD_LOG=research/requests2.log RECORD_MOCK=research/mock2.json \
  node scripts/record-server.cjs > research/record-server2.log 2>&1 &
sleep 1

# 伪造注册（version 必须匹配 lildax 的 InstallationVersion）
RPID=$(ps aux | grep "scripts/record-server.cjs" | grep -v grep | awk '{print $2}' | head -1)
VERSION=$(strings "$LILDAX" | grep -oE "0\.0\.0-dev-[0-9]+" | head -1)
echo "{\"id\":\"fake\",\"version\":\"$VERSION\",\"url\":\"http://127.0.0.1:4199\",\"pid\":$RPID}" > .xdg-state9/opencode/server.json
echo "env ready: serve=4102 record=4199 version=$VERSION rpid=$RPID"
curl -s -m 3 -H "Authorization: Basic $(printf 'opencode:%s' "$PASS" | base64)" http://127.0.0.1:4102/api/health
echo
