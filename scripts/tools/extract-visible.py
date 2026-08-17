#!/usr/bin/env python3
"""提取 ANSI 流中的可见文本（诊断用）。用法: extract-visible.py <file> [max]"""
import re, sys

PAT = rb'(\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_G[^\x1b]*\x1b\\|\x1bP[^\x1b]*\x1b\\|\x1b[c=>()0-9A-FM78]|\x1b[78])'

data = open(sys.argv[1], "rb").read()
tokens = re.split(PAT, data)
vis = []
for t in tokens:
    if t.startswith(b"\x1b"):
        continue
    for ch in t:
        if ch >= 32 and ch not in b" ":
            vis.append(chr(ch))
text = "".join(vis)
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 800
print(f"bytes={len(data)}")
print("visible:", repr(text[:limit]))
