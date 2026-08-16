#!/usr/bin/env python3
"""标准终端回复模拟器：响应 OpenTUI/终端的查询序列（DSR/DECRQSS/OSC/XTGETXTR/kitty）。"""
import os
import re
import threading

# (正则 str, 回复 str)；用 \x1b 表示 ESC，\x07 表示 BEL
QUERIES = [
    (r"\x1b\[6n", "\x1b[1;1R"),                        # DSR 光标位置
    (r"\x1bP\+q([0-9a-f]+)\x1b\\", "\x1bP0$r\x1b\\"),  # DECRQSS：不识别
    (r"\x1b\[>0q", "\x1b[>0;1;0c"),                    # XTGETXTR
    (r"\x1b\[\?u", "\x1b[?u"),                          # kitty keyboard：不支持
    (r"\x1b\]10;\?\x07", "\x1b]10;rgb:1c1c/1c1c/1c1c\x07"),
    (r"\x1b\]11;\?\x07", "\x1b]11;rgb:1c1c/1c1c/1c1c\x07"),
    (r"\x1b\](1[2-9]);\?\x07", "\x1b]\\1;rgb:1c1c/1c1c/1c1c\x07"),
    (r"\x1b\]4;(\d+);\?\x07", "\x1b]4;\\1;rgb:0000/0000/0000\x07"),
    (r"\x1b\[c", "\x1b[?62;1;2;6;9;15;22c"),      # DA1 设备属性
    (r"\x1b_Gi=(\d+),[^\x07\x1b]*\x1b\\", "\x1b_Gi=\\1;OK\x1b\\"),  # kitty graphics 查询
    (r"\x1b\]1337;Capabilities\x1b\\", "\x1b]1337;Capabilities=report-cell-size\x1b\\"),  # iTerm2 能力查询
    (r"\x1b\[14t", "\x1b[4;36;120t"),                  # 窗口尺寸
    (r"\x1b\[\?1016\$p", "\x1b[?1016;0$y"),            # DECRQM
    (r"\x1b\[\?2027\$p", "\x1b[?2027;0$y"),
    (r"\x1b\[\?2031\$p", "\x1b[?2031;0$y"),
    (r"\x1b\[\?1004\$p", "\x1b[?1004;0$y"),
    (r"\x1b\[\?2004\$p", "\x1b[?2004;0$y"),
    (r"\x1b\[\?2026\$p", "\x1b[?2026;0$y"),
]

_COMPILED = [(re.compile(p), r.encode()) for p, r in QUERIES]


class TermResponder:
    def __init__(self, master_fd, threaded=True):
        self.master = master_fd
        self.buf = ""
        self._stop = threading.Event()
        if threaded:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self):
        import select
        while not self._stop.is_set():
            r, _, _ = select.select([self.master], [], [], 0.1)
            if not r:
                continue
            try:
                data = os.read(self.master, 65536)
            except OSError:
                break
            if not data:
                break
            self.buf += data.decode("utf-8", "replace")
            self._reply()

    def _reply(self):
        while True:
            hit = None
            for pat, reply in _COMPILED:
                m = pat.search(self.buf)
                if m:
                    hit = (m, reply)
                    break
            if not hit:
                return
            m, reply = hit
            self.buf = self.buf[m.end():]
            out = reply
            for i in range(1, m.re.groups + 1):
                out = out.replace(("\\" + str(i)).encode(), m.group(i).encode())
            try:
                os.write(self.master, out)
            except OSError:
                return

    def stop(self):
        self._stop.set()

    def feed_sync(self, data: bytes) -> bytes:
        """同步模式：把读到的数据喂进来，返回需要写回 master 的应答字节。
        用于与捕获主循环共用同一 fd 的场景（避免多 reader 竞争死锁）。"""
        self.buf += data.decode("utf-8", "replace")
        out = b""
        while True:
            hit = None
            for pat, reply in _COMPILED:
                m = pat.search(self.buf)
                if m:
                    hit = (m, reply)
                    break
            if not hit:
                return out
            m, reply = hit
            self.buf = self.buf[m.end():]
            r = reply
            for i in range(1, m.re.groups + 1):
                r = r.replace(("\\" + str(i)).encode(), m.group(i).encode())
            out += r
