# tui/ — opencode 界面代码精简版

从 [anomalyco/opencode](https://github.com/anomalyco/opencode)（dev 分支）**只提取
界面与直连所需代码**，供 dsh-opencode-tui 使用。不再保留整个 opencode 仓库。

## 与上游的差异

| 项目 | 上游 opencode | 本目录 |
|---|---|---|
| 包数量 | 34 个 packages | 10 个 |
| 删除 | — | server / opencode / app / web / console / desktop / stats / docs / storybook / slack / enterprise / containers / function / http-recorder / identity / session-ui / codemode / protocol / sdk-next / client / httpapi-codegen / effect-sqlite-node |
| CLI | 全功能命令集（serve / daemon / api / migrate …） | 仅直连模式（`OPENCODE_URL` → 启动 TUI） |
| node_modules | 约 2.5G | 约 335M |
| 二进制 | 约 110M | 约 107M（主要体积是 opentui 原生库 + Bun 运行时） |

## 保留的包

- `cli` — 极简入口（`src/index.ts` 用 `NodeRuntime.runMain` 执行 `runTui` Effect）；
  `src/tui.ts` 提供内置插件 host（侧边栏 / 提问对话框 / which-key 等）
- `tui` — 界面本体（152 个源文件，含 fork 补丁：home 布局、Prompt 输入、侧边栏 Context 明细）
- `ui` — 仅音频资产（TUI 的提示音）
- `plugin` — TUI 插件 API 类型与 Effect 绑定
- `sdk` — opencode SDK（v2 client）
- `core` — TUI 运行所需的 core 子集（Effect 运行时 / global / flag 等），
  依赖裁剪到实际用到的第三方包；provider 注册表只保留 opencode 内置 + 动态
- `schema` — 协议 schema（core 依赖）
- `llm` — 模型协议（core 依赖）
- `effect-drizzle-sqlite` — 数据库层（core 依赖）
- `script` — 构建工具（版本号固定，避免网络/ git 依赖）

## 构建

```bash
cd packages/cli
bun run script/build.ts     # 输出 dist/cli-linux-x64/bin/lildax
```

## 运行

二进制由 dsh 插件（dsh-opencode-tui）spawn，直连其兼容层：

```bash
OPENCODE_URL=http://127.0.0.1:<port> dist/cli-linux-x64/bin/lildax
```

## 依赖安装

沙箱/受限环境下 bun 可能无法访问系统临时目录，可用项目内目录：

```bash
mkdir -p .bun-install .bun-tmp
BUN_INSTALL=$PWD/.bun-install BUN_TMPDIR=$PWD/.bun-tmp bun install
```
