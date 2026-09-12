#!/usr/bin/env bash
# Format-on-save hook — chạy sau mỗi Write/Edit (PostToolUse).
# Được gọi từ .claude/settings.json: `bash .claude/hooks/format.sh`.
#
# Claude Code truyền payload JSON qua STDIN; đường dẫn file vừa sửa ở `.tool_input.file_path`.
# Dùng prettier repo-local (devDependency ở root), KHÔNG tải package remote một lần.

set -uo pipefail

# Không có jq thì thoát sạch — hook không được làm hỏng luồng làm việc.
command -v jq >/dev/null 2>&1 || exit 0

FILE=$(cat | jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

# Chỉ format những đuôi prettier hiểu. File .sql (migration) và .md spec để nguyên.
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.yml|*.yaml)
    npx --no-install prettier --write "$FILE" >/dev/null 2>&1 || true
    ;;
esac

exit 0
