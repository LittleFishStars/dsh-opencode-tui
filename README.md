# dsh-opencode-tui

让 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 使用
**opencode 原版 TUI**：直接复用 opencode 的终端界面（会话列表、消息流、工具卡片、
审批对话框、鼠标与主题全部由 opencode 原版提供），Agent/会话/工具/权限则由 dsh
驱动。

## 架构

opencode 的 TUI 只依赖几个很小的 Go 接口（`session.Service`、`message.Service`、
`agent.Service`、`permission.Service`、`history.Service`）。本仓库 fork 了
opencode（`opencode-fork/`，独立 git 仓库），在其中实现了一套 **dsh bridge**，
把全部服务调用转发给一个 dsh 子进程（stdio JSONL 协议），UI 保持 opencode 原版零改动。

```
┌─────────────────────────────────────────────┐
│ dsh --profile dsh-opencode-tui（Node 进程）  │
│  插件：spawn opencode fork + 信号/退出透传   │
└──────────────────┬──────────────────────────┘
                   │ DSH_BRIDGE=1
┌──────────────────▼──────────────────────────┐
│ opencode-fork（Go）                          │
│  ┌───────────────────────────────────────┐  │
│  │ internal/tui/  （opencode 原版）       │  │
│  └───────────────┬───────────────────────┘  │
│  ┌───────────────▼───────────────────────┐  │
│  │ internal/app/dsh/  bridge（5 个接口）  │  │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────┘
                   │ stdio JSONL（子进程）
┌──────────────────▼──────────────────────────┐
│ dsh --profile dsh-opencode-tui --patch      │
│   bridge.yml（桥插件，只激活 bridge）        │
│  src/bridge.ts + agent/projection/审批队列   │
└─────────────────────────────────────────────┘
```

## 使用

```bash
# 唯一入口：dsh 标准启动方式
dsh --profile dsh-opencode-tui

# 等价于：
#   dsh 进程 → spawn opencode fork（DSH_BRIDGE=1）
#   → opencode 内部再拉起 dsh 桥子进程（--patch bridge.yml）
```

要求：
- `dsh-opencode-tui` profile 已安装本包（`dsh plugin --profile dsh-opencode-tui add <本仓库路径>`）
- opencode fork 二进制：默认找 `opencode-fork/opencode`（本仓库）或
  `$DSH_HOME/opencode-fork/opencode`，缺失时自动 `go build`（Go ≥ 1.24）

首次运行会在 `~/.config/opencode` 生成 opencode 自己的配置；会话与消息
全部存在 DSH 的 `~/.dsh/sessions`（与 dsh web 互通）。Ctrl+C 退出对话框
默认选 No（防误退），Tab 切到 Yes 后 Enter 退出——这是 opencode 原版行为。

## 桥协议

- Go → DSH：`{"id":1,"method":"session.create","params":{...}}`
- DSH → Go：`{"id":1,"result":...}` / `{"event":"message/updated","sessionId":...,"message":{...}}`
- 事件：`agent/start|done`、`message/created|updated`、`session/title`、
  `approval/request|resolved`、`question/request`
- 审批：DSH `approval/request` → opencode 权限对话框 → `approval.decide` 回写

## 开发

```bash
npm install && npm run build          # 编译插件（lib/）
cd opencode-fork && go build -o opencode .   # fork 编译（bridge 已在其中）
python3 scripts/pty-test5.py          # 端到端回归（dsh --profile 入口，真实 PTY）

DSH_BRIDGE=1 go run ./cmd/bridge-harness    # 桥单测（不经 TUI）
```

## 已知边界（后续可扩展）

- 侧栏 "Modified Files" 为空（history 空实现，可从工具事件合成）
- 附件（ctrl+f）未接入 dsh attachment
- Summarize 简化为 dsh 的 /compact 直通

## 许可

MIT
