#!/usr/bin/env bash
# bootstrap.sh — Hoàn tất setup sau khi clone template từ GitHub.
# Chạy 1 lần duy nhất khi tạo dự án mới từ template.
#
# Việc mà script làm:
#   1. Chạy `specify init .` để tạo .specify/ + slash command của Spec Kit
#   2. Merge cấu trúc Spec Kit vào .claude/ đã có sẵn (giữ agents + settings + design-to-code command)
#   3. In hướng dẫn bước tiếp theo

set -euo pipefail

echo "==> Kiểm tra công cụ cần thiết..."
command -v git >/dev/null 2>&1 || { echo "Cần cài git trước."; exit 1; }
command -v uvx >/dev/null 2>&1 || command -v pipx >/dev/null 2>&1 || {
  echo "Cần cài uv (khuyên dùng) hoặc pipx trước khi chạy bootstrap."
  echo "Xem: https://github.com/astral-sh/uv#installation"
  exit 1
}

if [ -d .specify ]; then
  echo "==> .specify/ đã tồn tại — bỏ qua specify init."
else
  echo "==> Đang chạy specify init ..."
  # Backup .claude trước, vì specify init có thể ghi đè
  if [ -d .claude ]; then
    cp -r .claude .claude.template-backup
  fi

  # --force: bắt buộc khi init vào thư mục đã có file (template luôn không rỗng),
  # nếu thiếu, specify sẽ hỏi xác nhận và treo dưới `set -euo pipefail`.
  if command -v uvx >/dev/null 2>&1; then
    uvx --from git+https://github.com/github/spec-kit.git specify init . --force --integration claude
  else
    pipx run --spec git+https://github.com/github/spec-kit.git specify init . --force --integration claude
  fi

  # Merge lại: nếu specify init ghi đè settings.json / agents / commands của template,
  # khôi phục từ backup rồi merge command speckit.* vào
  if [ -d .claude.template-backup ]; then
    # Giữ nguyên agents, hooks và settings của template
    cp -r .claude.template-backup/agents/* .claude/agents/ 2>/dev/null || true
    mkdir -p .claude/hooks && cp -r .claude.template-backup/hooks/* .claude/hooks/ 2>/dev/null || true
    cp .claude.template-backup/settings.json .claude/settings.json 2>/dev/null || true
    # Command của template (design-to-code) không bị Spec Kit đụng tới, nhưng copy lại cho chắc
    cp .claude.template-backup/commands/design-to-code.md .claude/commands/ 2>/dev/null || true
    rm -rf .claude.template-backup
  fi
fi

# ==> Chốt cơ chế đánh số feature = timestamp (chống trùng khi nhiều người chạy song song).
#     /speckit-specify sẽ sinh specs/<YYYYMMDD-HHMMSS>-<slug> — duy nhất toàn cục, không quét specs/.
#     (Tên branch vẫn là NNN-<slug> = số issue, cho PR/traceability — 2 lớp số khác nhau.)
if [ -d .specify ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import json, os
p = ".specify/init-options.json"
data = {}
if os.path.exists(p):
    try:
        with open(p) as f:
            data = json.load(f)
    except Exception:
        data = {}
data["feature_numbering"] = "timestamp"
with open(p, "w") as f:
    json.dump(data, f, indent=2)
print(f"==> Đã đặt feature_numbering=timestamp trong {p}")
PY
  else
    echo "==> (Bỏ qua) Không có python3 — hãy tự đặt \"feature_numbering\": \"timestamp\" trong .specify/init-options.json"
  fi
fi

# ==> Drift guard: template LUÔN dùng spec-kit mới nhất (bootstrap kéo thẳng main), nên tên/cấu trúc
#     skill có thể đổi giữa các bản. Kiểm các skill mà runbook /design-to-code tham chiếu có thật
#     không — báo sớm ngay lúc setup thay vì để user gặp "lệnh không tồn tại" giữa pipeline.
if [ -d .specify ]; then
  REFERENCED_SKILLS="constitution specify clarify plan tasks analyze implement"
  missing=""
  for s in $REFERENCED_SKILLS; do
    [ -e ".claude/skills/speckit-$s" ] || missing="$missing speckit-$s"
  done
  if [ -n "$missing" ]; then
    echo ""
    echo "⚠️  ================= CẢNH BÁO DRIFT SPEC KIT ================="
    echo "    Không thấy skill:$missing trong .claude/skills/"
    echo "    Bản spec-kit mới có thể đã ĐỔI TÊN / CẤU TRÚC skill."
    echo "    → Xem thực tế: ls .claude/skills/"
    echo "    → Cập nhật tên lệnh /speckit-* trong runbook cho khớp:"
    echo "      .claude/commands/design-to-code.md, README.md, CLAUDE.md, docs/*"
    echo "    Runbook đang giả định: /speckit-{constitution,specify,clarify,plan,tasks,analyze,implement}"
    echo "    =========================================================="
    echo ""
  else
    echo "==> Drift check OK: 7 skill /speckit-* runbook tham chiếu đều có mặt trong .claude/skills/."
  fi
fi

echo ""
echo "==> Bootstrap xong."
echo ""
echo "Bước tiếp theo:"
echo "  1. Mở dự án trong Claude Code."
echo "  2. Chạy /speckit-constitution để tạo constitution.md lần đầu."
echo "     Sau đó xem docs/CONSTITUTION_APPEND.md và cân nhắc bổ sung 3 article cho bối cảnh Nhật."
echo "  3. Cập nhật docs/00-glossary.md với thuật ngữ nghiệp vụ của dự án."
echo "  4. Với feature đầu tiên:"
echo "       git checkout -b 001-<feature-slug>"
echo "       Đặt tài liệu vào docs/01-basic-design/<feature>/ và docs/02-detail-design/<feature>/"
echo "       Chạy /design-to-code trong Claude Code."
