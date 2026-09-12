#!/usr/bin/env python3
"""Kiểm tra nội dung template (không chỉ sự tồn tại của file).

Chạy trong CI (smoke-test) và chạy được cả ở local:
    python3 .github/scripts/check-template.py

Bắt các lỗi mà check `test -f` bỏ sót:
  1. Link nội bộ (markdown) trỏ tới file không tồn tại.
  2. Frontmatter của subagent thiếu key bắt buộc (name/description/tools).
  3. Runbook `design-to-code.md` đánh số bước không liên tục từ 1.
  4. Mermaid dùng class (`:::x`) chưa được `classDef`.
  5. Glossary có thuật ngữ 日本語 trùng nhau (2 dòng cùng 1 term → nhập nhằng).

Không phụ thuộc package ngoài — chỉ dùng stdlib, không cần mạng.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def iter_markdown() -> list[str]:
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for fn in filenames:
            if fn.endswith(".md"):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def check_internal_links(md_files: list[str]) -> None:
    for path in md_files:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        base = os.path.dirname(path)
        for target in LINK_RE.findall(text):
            target = target.strip()
            # bỏ qua link ngoài / anchor thuần / mailto
            if target.startswith(("http://", "https://", "mailto:", "#", "<")):
                continue
            # cắt anchor và query
            clean = target.split("#", 1)[0].split("?", 1)[0].strip()
            if not clean:
                continue
            resolved = os.path.normpath(os.path.join(base, clean))
            if not os.path.exists(resolved):
                rel = os.path.relpath(path, ROOT)
                err(f"[link] {rel}: link trỏ tới file không tồn tại → {target}")


REQUIRED_FRONTMATTER = ("name:", "description:", "tools:")


def check_agent_frontmatter() -> None:
    agents_dir = os.path.join(ROOT, ".claude", "agents")
    if not os.path.isdir(agents_dir):
        err("[frontmatter] không tìm thấy .claude/agents/")
        return
    for fn in sorted(os.listdir(agents_dir)):
        if not fn.endswith(".md"):
            continue
        path = os.path.join(agents_dir, fn)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if not text.startswith("---"):
            err(f"[frontmatter] .claude/agents/{fn}: thiếu frontmatter mở đầu `---`")
            continue
        end = text.find("\n---", 3)
        if end == -1:
            err(f"[frontmatter] .claude/agents/{fn}: thiếu `---` đóng frontmatter")
            continue
        block = text[3:end]
        for key in REQUIRED_FRONTMATTER:
            if key not in block:
                err(f"[frontmatter] .claude/agents/{fn}: thiếu key `{key}`")


STEP_RE = re.compile(r"^(\d+)\.\s", re.MULTILINE)


def check_runbook_numbering() -> None:
    path = os.path.join(ROOT, ".claude", "commands", "design-to-code.md")
    if not os.path.exists(path):
        err("[steps] không tìm thấy .claude/commands/design-to-code.md")
        return
    with open(path, encoding="utf-8") as f:
        text = f.read()
    nums = [int(n) for n in STEP_RE.findall(text)]
    expected = list(range(1, len(nums) + 1))
    if nums != expected:
        err(f"[steps] design-to-code.md: số bước không liên tục 1..N → thấy {nums}")


MERMAID_BLOCK_RE = re.compile(r"```mermaid\n(.*?)```", re.DOTALL)
CLASSDEF_RE = re.compile(r"classDef\s+(\w+)")
CLASSUSE_RE = re.compile(r":::(\w+)")


def check_mermaid(md_files: list[str]) -> None:
    for path in md_files:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for block in MERMAID_BLOCK_RE.findall(text):
            defined = set(CLASSDEF_RE.findall(block))
            used = set(CLASSUSE_RE.findall(block))
            missing = used - defined
            if missing:
                rel = os.path.relpath(path, ROOT)
                err(f"[mermaid] {rel}: dùng class chưa classDef → {sorted(missing)}")


SEP_RE = re.compile(r"^[\s|:\-]+$")


def check_glossary_duplicates() -> None:
    path = os.path.join(ROOT, "docs", "00-glossary.md")
    if not os.path.exists(path):
        err("[glossary] không tìm thấy docs/00-glossary.md")
        return
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    seen: dict[str, int] = {}
    for i, line in enumerate(lines, start=1):
        s = line.strip()
        if not s.startswith("|"):
            continue
        if SEP_RE.match(s):  # dòng phân cách |---|
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells:
            continue
        term = cells[0]
        if not term or term == "日本語":  # bỏ header
            continue
        if term in seen:
            err(f"[glossary] 日本語 '{term}' trùng ở dòng {seen[term]} và {i}")
        else:
            seen[term] = i


def main() -> int:
    md_files = iter_markdown()
    check_internal_links(md_files)
    check_agent_frontmatter()
    check_runbook_numbering()
    check_mermaid(md_files)
    check_glossary_duplicates()

    if errors:
        print("✗ check-template: phát hiện vấn đề\n")
        for e in errors:
            print("  " + e)
        print(f"\nTổng: {len(errors)} lỗi")
        return 1
    print("✓ check-template: link nội bộ, frontmatter, số bước, mermaid, glossary đều hợp lệ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
