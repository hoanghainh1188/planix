# Detail design (詳細設計) — tài liệu GỐC

Mỗi feature 1 thư mục: `docs/02-detail-design/<slug>/` (`<slug>` khớp branch `NNN-<slug>` — xem
`01-basic-design/README.md`).

Cùng quy tắc đặt / không-sửa / versioning như `01-basic-design`, **gồm cả yêu cầu bản export
text-extractable** (VD `field-spec-v1.md`) nếu chưa cài Skill đọc Office.

Đây là nơi chứa phần "thịt" mà `design-intake` đọc kỹ nhất trước khi sinh prompt `/speckit-specify`:

- **Bảng field + validation rule** — đặc biệt bảng Excel (hay giấu rule nghiệp vụ). Export ra
  markdown để không mất cấu trúc bảng khi parse.
- **Business rule + edge case + error state** — các nhánh xử lý, thông báo lỗi, điều kiện biên.

Input càng đủ 2 nhóm này, spec sinh ra càng ít ambiguity phải đưa vào `/speckit-clarify`.

Cùng quy tắc `CHANGELOG.md` như `01-basic-design`: mỗi bản mới ghi 1 mục kèm **Affected issues** (bắt
buộc) — số issue của feature bị ảnh hưởng để biết cái nào phải re-run (TEAM-WORKFLOW mục 8).
