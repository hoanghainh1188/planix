#!/usr/bin/env bash
# Format-on-save hook — chạy sau mỗi Write/Edit (PostToolUse) để format file vừa sửa.
# Được gọi từ .claude/settings.json: `bash .claude/hooks/format.sh`.
#
# ─────────────────────────────────────────────────────────────────────────────
# CÁCH BẬT (điền theo tech stack của dự án, rồi bỏ dòng `exit 0` mặc định bên dưới):
#
#   Claude Code truyền payload JSON qua STDIN; đường dẫn file vừa sửa nằm ở
#   `.tool_input.file_path`. Ví dụ lấy path (cần `jq`):
#     FILE=$(cat | jq -r '.tool_input.file_path // empty')
#
#   Rồi gọi formatter repo-local theo stack (ưu tiên tooling trong repo,
#   KHÔNG chạy package remote một lần — xem web/hooks.md):
#     TS/JS/web : [ -n "$FILE" ] && npx --no-install prettier --write "$FILE"
#     Go        : [ -n "$FILE" ] && gofmt -w "$FILE"
#     Python    : [ -n "$FILE" ] && python -m black "$FILE"
#     Java      : [ -n "$FILE" ] && ./gradlew spotlessApply    # hoặc google-java-format
#
#   Thứ tự chuẩn của toàn bộ chuỗi chất lượng: format → lint → type check → build.
#   (format tự chạy ở đây; lint/test/build chạy ở Test gate của /design-to-code.)
# ─────────────────────────────────────────────────────────────────────────────
#
# MẶC ĐỊNH: no-op — không làm gì, thoát sạch, để template chưa cấu hình formatter
# không bị lỗi hook. Xoá/thay dòng dưới khi đã điền formatter thật.
exit 0
