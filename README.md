# dsh-opencode-tui

让 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 使用
**opencode 原版 TUI**：直接复用 opencode 的终端界面（会话列表、消息流、工具卡片、
thinking 折叠、鼠标与主题全部由 opencode 原版提供），Agent/会话/工具/权限则由 dsh 驱动。

## 架构

opencode 的 TUI 是纯 HTTP 客户端：它通过一组 REST 端点（旧路径 `/session`、
`/config/providers`、`/global/event` 等 + v2 `/api/*`）与 SSE 事件流与 server 通信。
本仓库实现了一个 **opencode server 协议兼容层**（`src/oc-server.ts`），跑在 dsh
插件进程内，把 TUI 的请求映射到 dsh 的 agent/会话；TUI 二进制则是 opencode 官方
仓库（anomalyco/opencode，dev 分支）源码构建的 `lildax`（`opencode-fork/`，独立 git
仓库，仅有两处最小 patch：`default.ts` 支持 `OPENCODE_URL` 直连、`home.tsx` 布局
在部分终端下不渲染的修复）。

```
┌──────────────────────────────────────────────────────────┐
│ dsh --profile dsh-opencode-tui（Node 进程）               │
│  插件 plugin.ts：                                         │
│    ├─ src/oc-server.ts（opencode 协议兼容层，HTTP+SSE）   │
│    │    ├─ 旧路径：/session /session/:id/message          │
│    │    │          /config/providers /global/event …      │
│    │    └─ v2：/api/health /api/session /api/event …      │
│    └─ src/agent.ts（AgentManager → dsh agent 会话）       │
└──────────────────────┬─────────────────────────────────────┘
                       │ OPENCODE_URL=http://127.0.0.1:<port>
┌──────────────────────▼─────────────────────────────────────┐
│ opencode-fork lildax（opencode 原版 TUI，零改动直连）       │
└────────────────────────────────────────────────────────────┘
```

DSH 事件（`session/event`）→ opencode 事件（`message.updated` /
`message.part.updated` / `session.status`）→ SSE 推给 TUI，驱动消息流、
thinking 折叠与工具卡片的实时渲染。

## 使用

```bash
# 唯一入口：dsh 标准启动方式
dsh --profile dsh-opencode-tui
```

要求：
- `dsh-opencode-tui` profile 已安装本包（`dsh plugin --profile dsh-opencode-tui add <本仓库路径>`）
- opencode TUI 二进制：默认找 `opencode-fork/packages/cli/dist/cli-linux-x64/bin/lildax`
  （本仓库）或 `$DSH_HOME/opencode-fork/...` 同路径，缺失时按报错提示构建：
  `cd opencode-fork/packages/cli && bun run script/build.ts --single --skip-install`

配置（profile 的 `config`）：
- `binary`：lildax 路径
- `preset`：agent preset id（默认 roster 默认）
- `cwd`：工作目录（默认进程 cwd）
- `serverPort`：兼容层端口（默认随机；可用环境变量 `DSH_OPENCODE_TUI_SERVER_PORT`）
- `args`：透传给 TUI 的附加参数

会话与消息全部存在 DSH 的会话存储（`DSH_OPENCODE_SESSION_ROOT` 可重定向，
默认与 dsh web 互通）。Ctrl+C 退出对话框默认选 No（防误退），Tab 切到 Yes 后
Enter 退出——这是 opencode 原版行为。

## 兼容层协议要点

TUI 实测请求（fork dev lildax）：

- 启动（sync bootstrap，旧 + v2 混合）：`/path` `/project/current`
  `/config/providers` `/provider` `/experimental/*` `/agent` `/config`
  `/session` `/global/event`(SSE) `/command` `/lsp` `/mcp` `/formatter`
  `/session/status` `/provider/auth` `/vcs` + `/api/health` `/api/location`
  `/api/agent` `/api/integration` `/api/model` `/api/provider` `/api/reference`
  `/api/command` `/api/skill`
- 发送消息：`POST /session` → `POST /session/:id/message`
  （body `{parts: [{type:"text", text}]}`，响应 `{info, parts}`）
- 消息列表：`GET /session/:id/message`（`[{info, parts}]`）
- 事件流：`GET /global/event`（SSE，data 为 v2 GlobalEvent 信封
  `{directory, payload: {type, properties}}`；事件含 `message.updated` /
  `message.part.updated` / `session.status` / `session.updated` /
  `permission.asked` / `permission.replied`）
- 旧路径 404 时 TUI 用 `gracefulFetch` 兜底（`/config/providers` `/provider`
  `/agent` `/config` 有默认值），其余 404 按 TUI 容错处理

消息格式必须严格对齐旧 SDK 类型（`UserMessage`/`AssistantMessage` 无
`content` 字段，需要 `agent`/`model`/`parentID`/`mode`/`path`/`cost`/`tokens`
等），否则会话页渲染崩溃（TUI 弹崩溃对话框）。

启动时从 DSH 持久层重建历史会话（`hydrate`，`ses_<sha1>` 稳定 id），打开历史
会话发消息会 resume 原 DSH 会话继续。审批走 v2 `PermissionRequest`：
DSH `approval/request` → `permission.asked` 事件 → TUI 权限对话框 →
`POST /permission/:requestID/reply`（`{reply: "once"|"always"|"reject"}`）。

## 测试

`scripts/` 下的 pty 测试（python + term_responder 应答器）：
- `pty-test13.py`：文本回复端到端（发送 → DSH agent 回复 → TUI 渲染）
- `pty-test14.py`：工具调用端到端（bash → 输出渲染）
- `pty-test16.py`：审批端到端（写 /tmp 触发 approval → TUI 对话框 → Enter 批准 → 工具执行）
- `term_responder.py`：OpenTUI 终端查询应答（`threaded=False` 时同步模式，
  与捕获主循环共用 fd，避免多 reader 竞争死锁）

注意：
- fork serve 的 db 被 kill -9 损坏后 TUI 会数据加载失败 → 测试前清 db/state 目录
- OpenTUI 的 flex 布局在部分终端下不渲染（`home.tsx` 已用简化布局规避）
- 兼容层请求日志走 stderr（`[oc-server] ...`），诊断用
