# opencode 兼容层研究结论（2026-08-16）

## 关键发现

### 1. 官方二进制 1.18.18 的空白屏根因
- `opencode-ai@1.18.18` npm 包 = 预编译二进制（bun compile），`--version` = 1.18.18。
- 其 TUI 的 `pluginHost.start()` **真实加载插件且永不 settle** → `ready()` 永远 false →
  App 的 `<Show when={ready()}>` 不渲染主视口 → **空白屏 + 底部 "Loading plugins..." spinner**（这就是用户报的"什么都显示不出来"）。
- 该二进制 serve **不识别 `--register`**（打印 help 退出）→ daemon spawn 失败。
- 该二进制有 `attach <url>` 命令但 v1.18.18 tag 源码没有（构建自更新的 commit）。
- **结论：不用 1.18.18 二进制，改用 fork dev 源码构建的 lildax**（pluginHost 是 no-op，
  serve 支持 --register，行为完全可控）。

### 2. fork dev（anomalyco/opencode dev 分支）构建
- `cd packages/cli && bun run script/build.ts --single --skip-install` → `dist/cli-linux-x64/bin/lildax`（~115MB ELF）。
- InstallationVersion = 构建注入 `0.0.0-dev-<timestamp>`（二进制内 `VV="0.0.0-dev-..."`）。
- daemon 逻辑（packages/cli/src/services/daemon.ts）：
  - `opencode`（默认命令）→ daemon.transport() → 读 `$XDG_STATE_HOME/opencode/server.json`
  - 注册存在且 healthy（`GET /api/health` → `{healthy:true}`）且 version===InstallationVersion → 直连注册 URL
  - 否则 spawn `lildax serve --register`（detached）→ 轮询注册（50ms×100）
  - **伪造注册可行**：server.json `{id, version: <InstallationVersion>, url: <DSH server>, pid: <活进程>}`
- fork dev 的 TUI 用 **sdk/v2 客户端（/api/* 路径）+ 旧 SDK（旧路径）混合**调用。

### 3. TUI 启动请求序列（实测，fork dev lildax）
旧路径（404 时 gracefulFetch 兜底，legacyDefaults 只有 /config/providers /provider /agent /config）：
```
GET /path, /project/current, /config/providers, /provider, /experimental/capabilities,
/experimental/console, /agent, /config, /session?start=<ts>&scope=project,
/global/event (SSE), /command, /lsp, /mcp, /experimental/resource, /formatter,
/session/status, /provider/auth, /vcs, /experimental/workspace
```
v2 路径（fork serve 实现，必须 200）：
```
GET /api/health, /api/location, /api/agent, /api/integration, /api/model, /api/provider,
/api/reference, /api/command, /api/skill
```
v2 响应格式：`{"location": {...}, "data": <payload>}`（LocationMiddleware 包装）。
- `GET /api/health` → `{"healthy": true}`（无 location 包装）
- sync.tsx bootstrap：config.providers(/config/providers) + provider.list(/provider) + capabilities + agents(/agent) + config + project 阻塞；其余非阻塞。
- **/config/providers 返回非空 providers 是进入可输入 home 的前提**（空 → "Connect a provider" 引导）。
- /global/event 404 时客户端无限重连（backoff），不阻塞渲染。

### 4. 发送消息（submit）流程（源码）
prompt submitInner：`local.model.current()` 无 → DialogProviderConnect；有 →
`sdk.client.session.create({...})` → 之后 session 消息/agent run。

### 5. 沙箱测试环境
- term_responder.py（OSC/DSR/kitty 应答）+ python pty 可行；OpenTUI 初始化无 DSR/kitty 查询也正常（降级模式）。
- 偶发空白 = 渲染竞态（TUI 首帧时序），与 server 无关（请求序列完整）。
- **fork serve 的 db 损坏（kill -9）会导致 TUI 数据加载失败** → 测试前清 db。
- record-server.cjs：记录请求 + mock 命中 + 代理转发（**必须解 gzip 转发**，否则 TUI JSON 解析失败空白）。
- setup-proxy-env.sh：一键重建 serve(4102)+record(4199)+伪造 server.json。
- 进程名精确杀：`pkill -x lildax` / 按 pid 杀 record-server；`pkill -f` 会误杀自身 shell。

## 兼容层设计（DSH 侧）
- DSH 插件起 HTTP server（旧路径 + v2 /api/* 混合），复用 bridge.ts 的 dsh 子进程聚合（session/message/agent 事件）。
- TUI 启动：fork dev lildax + 伪造 server.json（version 匹配）→ 直连 DSH server；或 patch fork default.ts 支持 OPENCODE_URL env。
- 必要端点见上面清单；交互端点（POST /api/session 等）按 sdk v2 定义实现。
