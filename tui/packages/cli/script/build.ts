#!/usr/bin/env bun
/**
 * lildax 构建脚本（精简版）：只构建当前平台单个目标。
 *
 * 原版支持全平台矩阵；本项目仅在本机运行（DSH 插件 spawn 本机二进制），
 * 因此只构建当前 os/arch。用法：`bun run script/build.ts`。
 */

import { rm } from "fs/promises"
import path from "path"
import { Script } from "@opencode-ai/script"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { modelsData } from "./generate"

const dir = path.resolve(import.meta.dirname, "..")
const binary = "lildax"
process.chdir(dir)

await rm("dist", { recursive: true, force: true })

const plugin = createSolidTransformPlugin()
const item = { os: process.platform, arch: process.arch as "arm64" | "x64" }
const target = [
  binary,
  item.os === "win32" ? "windows" : item.os,
  item.arch,
]
  .filter(Boolean)
  .join("-")
const name = target.replace(binary, "cli")
console.log(`building ${name}`)

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  splitting: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: target.replace(binary, "bun") as Bun.Build.CompileTarget,
    outfile: `./dist/${name}/bin/${binary}`,
    execArgv: [`--user-agent=${binary}/${Script.version}`, "--use-system-ca", "--"],
    windows: {},
  },
  define: {
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_CLI_NAME: `'${binary}'`,
    OPENCODE_MODELS_DEV: modelsData,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
    OPENCODE_LIBC: item.os === "linux" ? "'glibc'" : "undefined",
    FFF_LIBC: item.os === "linux" ? "'gnu'" : "undefined",
    ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify("glibc") } : {}),
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await Bun.write(
  `./dist/${name}/package.json`,
  JSON.stringify(
    {
      name: `@opencode-ai/${name}`,
      version: Script.version,
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/anomalyco/opencode.git" },
      os: [item.os],
      cpu: [item.arch],
    },
    null,
    2,
  ),
)
