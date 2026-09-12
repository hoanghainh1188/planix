# Basic design (基本設計) — tài liệu GỐC từ khách hàng

Mỗi feature 1 thư mục: `docs/01-basic-design/<slug>/`
(`<slug>` = phần sau `NNN-` trên branch — VD `042-user-reservation` → `user-reservation/`;
cùng slug với `docs/02-detail-design/<slug>/`, `docs/03-ui/<slug>/`, `src/features/<slug>/`.)
Versioned (`v1.docx`, `v2.docx`…) + `CHANGELOG.md` khi có bản mới.
Agent KHÔNG BAO GIỜ sửa nội dung ở đây.

## Để `design-intake` dùng được (quan trọng)

`Read` KHÔNG parse được `.docx/.xlsx/.pdf` nhị phân. Cho mỗi feature, đảm bảo **một trong hai**:
- Skill `docx/xlsx/pdf` đã cài, HOẶC
- Đặt sẵn **bản export text/markdown** cạnh file gốc (VD `basic-design-v1.md`).

Layout gợi ý:

```
docs/01-basic-design/<slug>/
├── basic-design-v1.docx     # gốc khách (không sửa)
├── basic-design-v1.md       # ★ export text nếu chưa có Skill đọc Office
└── CHANGELOG.md
```

`design-intake` trích từ basic design: **user story / behavior** (làm gì, cho ai). Đảm bảo tài liệu
nêu rõ mục tiêu + phạm vi feature — đây là input cho `/speckit-specify`.

### `CHANGELOG.md` — bắt buộc có mục "Affected issues"

Khi khách gửi bản mới, thêm version + ghi 1 mục vào `CHANGELOG.md`. Mục **Affected issues** là **bắt
buộc** — liệt kê số issue của feature bị ảnh hưởng để biết cái nào phải re-run pipeline (TEAM-WORKFLOW mục 8):

```markdown
## v2 — 2026-07-10
- Thay đổi: <tóm tắt khách sửa gì so với v1>
- **Affected issues:** #42, #57   ← bắt buộc (để trống nếu chưa xác định → phải điều tra trước khi đóng)
```
