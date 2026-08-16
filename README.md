# dsh-opencode-tui

为 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 打造的 **opencode 风格交互式终端界面**：全屏 TUI，会话列表、markdown 消息流、实时工具调用卡片、opencode 同款键位与主题。

![layout](docs/layout.png)

## 特性

- **opencode 三区布局**：消息区（左）+ 输入编辑器（下）+ 会话信息侧边栏（右，有会话时显示）
- **消息渲染**：用户消息（蓝色左栏）、助手消息（橙色左栏 + markdown + 代码高亮）、工具调用卡片（`Bash: command` 风格，含运行中/完成/错误状态与结果体）
- **实时流式**：`assistant/chunk` 逐字渲染，`tool/call`/`tool/result` 即时更新，转圈 + 工作状态行（`Generating...` / `Waiting for tool response...`）
- **会话管理**：`ctrl+s` 会话列表（可过滤）、`ctrl+n` 新会话、启动 `--resume <id>` 恢复、自动标题（`session/title`）
- **opencode 键位**：`ctrl+c` 退出确认、`?` 帮助、`ctrl+k` 命令面板、`ctrl+o` 模型信息、`ctrl+t` 主题、`ctrl+f` 文件选择、`PgUp/PgDn/ctrl+u/ctrl+d` 滚动、`\`+Enter 换行、`ctrl+e` 外部编辑器
- **审批与提问**：`approval/request` 弹出允许/拒绝对话框；`ask_user_question` 选项菜单
- **主题**：opencode 暗色/亮色、Dracula，`ctrl+t` 切换并持久化

## 安装与启动

要求：Node ≥ 22.19、dsh CLI、pnpm（首次自举用）。

```bash
# 方式一：从本仓库一键启动（自动初始化 ~/.dsh/profiles/opencode）
node bin/dsh-opencode-tui.js

# 方式二：手动接入 profile
dsh plugin --profile opencode add /path/to/dsh-opencode-tui
dsh --profile opencode

# 恢复指定会话
dsh --profile opencode --resume <sessionId>
```

本 TUI 是一个 **dsh 插件包**（`dsh.bundle.patch` → `cordis.patch.yml`），直接骑在 `@deepseek-ai/dsh-base` 之上：

- 会话复用 dsh 的 JSONL 持久层（`~/.dsh/sessions`），与 dsh web 的会话互通
- Agent 通过 `ctx.agents.create/resume` 驱动，事件流走 `session/event` firehose
- 工具/预设由 `agent-presets`（standard）组合；权限走 `sandbox-policy` + `approval`
- 默认全屏（alt screen），`fullscreen: false` 可关

## 键位

| 键 | 功能 |
| --- | --- |
| `enter` | 发送消息（行尾 `\` + enter 换行） |
| `esc` | 取消生成 / 关闭对话框 |
| `?` | 帮助（输入框为空时） |
| `ctrl+c` | 退出确认 |
| `ctrl+n` | 新会话 |
| `ctrl+s` | 会话列表 |
| `ctrl+k` | 命令面板（new / resume / compact / init / help / theme / models / quit） |
| `ctrl+o` | 模型信息 |
| `ctrl+t` | 主题切换 |
| `ctrl+f` | 文件选择（插入路径到输入框） |
| `ctrl+e` | 外部编辑器（$EDITOR / nvim，保存后直接发送） |
| `ctrl+a` / `ctrl+k` / `ctrl+w` | 行首 / 杀到行尾 / 杀词 |
| `pgup` `pgdn` `ctrl+u` `ctrl+d` | 消息区翻页滚动 |

对话框内：`↑/↓` 或 `k/j` 导航，`enter` 确认，`esc` 关闭，输入即过滤。

## 开发

```bash
npm install        # 依赖
npm run build      # tsc 编译到 lib/
npm run smoke      # 模块加载冒烟
npm run tui        # 本地启动（经启动器）

# 无头回归测试（PTY 驱动真实 TUI）
python3 scripts/pty-test3.py
```

结构：

```
src/
├── plugin.ts           # Cordis 插件入口：Agent/事件/审批/提问接线 + Ink 渲染
├── agent.ts            # agents.create/resume/followup/cancel/flush
├── projection.ts       # 会话事件日志 → 消息视图（增量 + 全量回放）
├── store.ts            # useSyncExternalStore 快照 + 审批/提问队列
├── markdown.tsx        # marked 分词 + highlight.js 语法高亮
├── ansi.tsx            # 工具输出 ANSI 渲染（自实现 SGR 解析）
├── theme.ts            # opencode / opencode-light / dracula 主题
└── components/         # App / Messages / Message / ToolCall / Editor / Sidebar / Dialog / StatusBar
```

## 许可

MIT

---

## opencode 原版 TUI（Go 中间层模式）

除了自研 Ink TUI，本仓库还提供 **直接复用 opencode 原版 TUI** 的中间层方案：
opencode 的 TUI 只依赖几个很小的 Go 接口（`session.Service`、`message.Service`、
`agent.Service`、`permission.Service`、`history.Service`），本仓库 fork 了
opencode（`opencode-fork/`），在其中实现了一套 **dsh bridge**，把全部服务调用
转发给一个 DSH 子进程（stdio JSONL 协议），UI 完全保持 opencode 原版。

```
┌─────────────────────────────────────────────┐
│ opencode-fork（Go）                          │
│  ┌───────────────────────────────────────┐  │
│  │ internal/tui/  （原版，零改动）        │  │
│  └───────────────┬───────────────────────┘  │
│  ┌───────────────▼───────────────────────┐  │
│  │ internal/app/dsh/  bridge 实现 5 个接口 │ │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────┘
                   │ stdio JSONL（子进程）
┌──────────────────▼──────────────────────────┐
│ dsh-opencode-tui 桥插件（src/bridge.ts）     │
│  dsh --profile opencode --patch bridge.yml  │
└─────────────────────────────────────────────┘
```

### 启动方式（两个入口）

```bash
# 入口一（推荐）：opencode 原版 TUI（Go 中间层）
dsh-opencode-tui                    # 自动编译 fork 并 DSH_BRIDGE=1 启动
# 或手工：cd opencode-fork && go build -o opencode . && DSH_BRIDGE=1 ./opencode

# 入口二：自研 Ink TUI（黑背景/灰侧栏/thinking与工具折叠版）
dsh --profile dsh-opencode-tui
```

桥子进程默认使用 `dsh-opencode-tui` profile（`DSH_BRIDGE_PROFILE` 可覆盖）。
首次运行会在 `~/.config/opencode` 生成 opencode 自己的配置；会话与消息
全部存在 DSH 的 `~/.dsh/sessions`（与 dsh web 互通）。Ctrl+C 退出对话框
默认选 No（防误退），Tab 切到 Yes 后 Enter 退出——这是 opencode 原版行为。

### 桥协议

- Go → DSH：`{"id":1,"method":"session.create","params":{...}}`
- DSH → Go：`{"id":1,"result":...}` / `{"event":"message/updated","sessionId":...,"message":{...}}`
- 事件：`agent/start|done`、`message/created|updated`、`session/title`、
  `approval/request|resolved`、`question/request`
- 审批：DSH `approval/request` → opencode 权限对话框 → `approval.decide` 回写
- 回归测试：`python3 scripts/pty-test5.py`（真实 PTY 驱动 fork + 桥）

### 开发

```bash
cd opencode-fork && go build -o opencode .        # fork 编译
DSH_BRIDGE=1 go run ./cmd/bridge-harness           # 桥单测（不经 TUI）
```
