#!/usr/bin/env python3
"""迷你 ANSI 终端模拟器：把 pty 输出流渲染成最终屏幕帧。"""
import re, sys

class MiniTerm:
    def __init__(self, cols=120, rows=36):
        self.cols, self.rows = cols, rows
        self.screen = [[" "] * cols for _ in range(rows)]
        self.x = self.y = 0
        self.saved = None
        self.alt = [[" "] * cols for _ in range(rows)]
        self.using_alt = False
        self._buf = ""

    def _cur(self):
        return self.alt if self.using_alt else self.screen

    def feed(self, data):
        self._buf += data
        while self._buf:
            # 找最早的控制序列
            m = re.search(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>]|\x1bM|\x1b7|\x1b8|\x1bD", self._buf)
            if m and m.start() == 0:
                self._handle(m.group(0))
                self._buf = self._buf[m.end():]
                continue
            if m:  # 前有普通文本
                self._text(self._buf[:m.start()])
                self._buf = self._buf[m.start():]
                continue
            # 无控制序列：全部为文本（但可能有未完成的序列开头）
            if "\x1b" in self._buf:
                idx = self._buf.index("\x1b")
                if idx > 0:
                    self._text(self._buf[:idx])
                    self._buf = self._buf[idx:]
                    continue
                # 以 ESC 开头但未匹配到完整序列：可能被截断，等待更多数据
                return
            self._text(self._buf)
            self._buf = ""

    def _text(self, s):
        cur = self._cur()
        for ch in s:
            if ch == "\r":
                self.x = 0
            elif ch == "\n":
                self.y = min(self.rows - 1, self.y + 1)
            elif ch == "\b":
                self.x = max(0, self.x - 1)
            elif ch == "\x07":
                pass
            elif ord(ch) < 32:
                pass
            else:
                if 0 <= self.y < self.rows and 0 <= self.x < self.cols:
                    cur[self.y][self.x] = ch
                self.x += 1
                if self.x >= self.cols:
                    self.x = 0
                    self.y = min(self.rows - 1, self.y + 1)

    def _handle(self, seq):
        if seq.startswith("\x1b[?") and seq.endswith("h"):
            # 私有模式
            if "1049" in seq:
                self.using_alt = True
                self.alt = [[" "] * self.cols for _ in range(self.rows)]
            return
        if seq.startswith("\x1b[?") and seq.endswith("l"):
            if "1049" in seq:
                self.using_alt = False
            return
        if seq == "\x1b7":
            self.saved = (self.x, self.y)
            return
        if seq == "\x1b8":
            if self.saved:
                self.x, self.y = self.saved
            return
        if seq == "\x1bM":
            self.y = max(0, self.y - 1)
            return
        if seq.startswith("\x1b["):
            self._csi(seq[2:-1], seq[-1])
            return
        # 其他（OSC 等）忽略

    def _csi(self, params, final):
        if final == "H" or final == "f":
            p = params.split(";")
            self.y = (int(p[0]) - 1) if p and p[0] else 0
            self.x = (int(p[1]) - 1) if len(p) > 1 and p[1] else 0
            self.y = max(0, min(self.rows - 1, self.y))
            self.x = max(0, min(self.cols - 1, self.x))
        elif final == "A":
            self.y = max(0, self.y - (int(params) if params else 1))
            self.x = min(self.x, self.cols - 1)
        elif final == "B":
            self.y = min(self.rows - 1, self.y + (int(params) if params else 1))
        elif final == "C":
            self.x = min(self.cols - 1, self.x + (int(params) if params else 1))
        elif final == "D":
            self.x = max(0, self.x - (int(params) if params else 1))
        elif final == "G":
            self.x = max(0, min(self.cols - 1, int(params) - 1)) if params else 0
        elif final == "d":
            self.y = max(0, min(self.rows - 1, int(params) - 1)) if params else 0
        elif final == "J":
            cur = self._cur()
            mode = int(params) if params else 0
            if mode == 2:
                for r in range(self.rows):
                    for c in range(self.cols):
                        cur[r][c] = " "
            elif mode == 0:
                for c in range(self.x, self.cols):
                    cur[self.y][c] = " "
                for r in range(self.y + 1, self.rows):
                    for c in range(self.cols):
                        cur[r][c] = " "
            elif mode == 1:
                for c in range(0, self.x + 1):
                    cur[self.y][c] = " "
                for r in range(0, self.y):
                    for c in range(self.cols):
                        cur[r][c] = " "
        elif final == "K":
            cur = self._cur()
            mode = int(params) if params else 0
            if mode == 0:
                for c in range(self.x, self.cols):
                    cur[self.y][c] = " "
            elif mode == 1:
                for c in range(0, self.x + 1):
                    cur[self.y][c] = " "
            elif mode == 2:
                for c in range(self.cols):
                    cur[self.y][c] = " "
        elif final == "m":
            pass  # SGR 颜色忽略
        else:
            pass  # 其他忽略

    def frame(self):
        cur = self.alt if self.using_alt else self.screen
        return "\n".join("".join(row).rstrip() for row in cur)

    def dump(self, path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.frame())


if __name__ == "__main__":
    import glob
    term = MiniTerm(120, 36)
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        term.feed(f.read())
    print(term.frame())
