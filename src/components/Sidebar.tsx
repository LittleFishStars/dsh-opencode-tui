/**
 * 右侧面板（opencode 风格）：Session 信息 + 修改文件列表。
 * 会话激活时才显示。
 */
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { execFile } from "node:child_process";
import type { Theme } from "../theme.js";
import type { SessionMeta } from "../projection.js";
import { truncate, widthOf } from "../util.js";

interface ModFile {
  path: string;
  additions: number;
  removals: number;
}

/** 运行 git status --porcelain 获取修改文件（带增删行数）。 */
function loadModifiedFiles(cwd: string): Promise<ModFile[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain", "--short"],
      { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const files: ModFile[] = [];
        for (const line of stdout.split("\n")) {
          if (line.trim() === "") continue;
          const status = line.slice(0, 2);
          const path = line.slice(3).trim();
          if (path === "") continue;
          if (/^R/.test(status)) continue; // 重命名交给 diff 显示
          files.push({ path, additions: 0, removals: 0 });
        }
        resolve(files.slice(0, 30));
      },
    );
  });
}

function loadDiffStats(cwd: string, paths: string[]): Promise<Map<string, { add: number; del: number }>> {
  if (paths.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--numstat", "--", ...paths],
      { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 5000 },
      (error, stdout) => {
        const map = new Map<string, { add: number; del: number }>();
        if (error) {
          resolve(map);
          return;
        }
        for (const line of stdout.split("\n")) {
          const parts = line.split("\t");
          if (parts.length < 3) continue;
          const add = Number.parseInt(parts[0]!, 10);
          const del = Number.parseInt(parts[1]!, 10);
          map.set(parts[2]!, {
            add: Number.isNaN(add) ? 0 : add,
            del: Number.isNaN(del) ? 0 : del,
          });
        }
        resolve(map);
      },
    );
  });
}

export interface SidebarProps {
  theme: Theme;
  width: number;
  height: number;
  session: SessionMeta | null;
  model: { provider: string; model: string } | null;
  cwd: string;
}

export function Sidebar({ theme, width, height, session, model, cwd }: SidebarProps): React.ReactElement {
  const [modFiles, setModFiles] = useState<ModFile[]>([]);
  const sessionId = session?.id ?? null;

  useEffect(() => {
    if (!sessionId) {
      setModFiles([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const files = await loadModifiedFiles(cwd);
      if (cancelled) return;
      const stats = await loadDiffStats(
        cwd,
        files.map((f) => f.path),
      );
      if (cancelled) return;
      setModFiles(
        files.map((f) => {
          const s = stats.get(f.path);
          return { ...f, additions: s?.add ?? 0, removals: s?.del ?? 0 };
        }),
      );
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, cwd]);

  const bg = theme.sidebarBg;
  const textWidth = Math.max(10, width - 2);
  /** 满宽灰底行：内容 + 空格填充到整行（嵌套 Text 继承父背景）。 */
  const line = (children: React.ReactNode, pad = 0, color?: string): React.ReactElement => (
    <Text backgroundColor={bg} color={color}>
      {children}
      {" ".repeat(Math.max(0, textWidth - pad))}
    </Text>
  );
  const rowLine = (label: string, value: string): React.ReactElement => {
    const v = truncate(value, Math.max(5, textWidth - label.length - 3));
    return line(
      <>
        <Text color={theme.primary} bold={true}>
          {label}
        </Text>
        <Text color={theme.text}>: {v}</Text>
      </>,
      widthOf(label) + 2 + widthOf(v),
    );
  };
  const fileLine = (f: ModFile): React.ReactElement => {
    const stats = `${f.additions > 0 ? ` +${f.additions}` : ""}${f.removals > 0 ? ` -${f.removals}` : ""}`;
    const path = truncate(f.path, Math.max(5, textWidth - widthOf(stats) - 2));
    return line(
      <>
        <Text color={theme.text}>{path}</Text>
        {f.additions > 0 ? <Text color={theme.success}>{` +${f.additions}`}</Text> : null}
        {f.removals > 0 ? <Text color={theme.error}>{` -${f.removals}`}</Text> : null}
      </>,
      widthOf(path) + widthOf(stats),
    );
  };

  const rows: React.ReactElement[] = [];
  rows.push(
    line(
      <Text color={theme.primary} bold={true}>
        {" "}dsh ⌬ opencode
      </Text>,
      widthOf(" dsh ⌬ opencode"),
    ),
  );
  rows.push(line(" "));
  if (session) {
    rows.push(rowLine("Session", session.title || "New Session"));
    rows.push(rowLine("Model", model ? `${model.provider}/${model.model}` : "-"));
    rows.push(rowLine("CWD", cwd));
    rows.push(rowLine("Messages", String(session.messageCount)));
  } else {
    rows.push(line(<Text color={theme.textMuted}> No active session</Text>, widthOf(" No active session")));
  }
  rows.push(line(" "));
  rows.push(
    line(
      <Text color={theme.primary} bold={true}>
        {" "}Modified Files:
      </Text>,
      widthOf(" Modified Files:"),
    ),
  );
  if (modFiles.length === 0) {
    rows.push(line(<Text color={theme.textMuted}> No modified files</Text>, widthOf(" No modified files")));
  } else {
    for (const f of modFiles) rows.push(fileLine(f));
  }
  rows.push(line(" "));
  rows.push(line(<Text color={theme.textMuted} dimColor={true}> ctrl+s sessions · ctrl+k commands</Text>));

  // 超高时截断（sidebar 不滚动）
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {rows}
    </Box>
  );
}
