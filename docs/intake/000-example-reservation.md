> ⚠️ **FEATURE MẪU — XOÁ TRƯỚC KHI DÙNG THẬT.**
> Đây là ví dụ minh hoạ output của subagent `design-intake` để bạn pattern-match.
> **File thật** đặt tên `docs/intake/<NNN>-<slug>.md` (VD issue #42 → `042-user-reservation.md`).
> Xoá cả bộ file mẫu:
> `docs/intake/000-example-reservation.md`, `docs/04-decisions/2026-01-01-approval-vs-confirm.md`,
> thư mục `specs/000-example-reservation/`, và `src/features/example-reservation/`.

# Intake — 予約承認 (Duyệt đặt chỗ) · feature `000-example-reservation`

## Input sources
- `docs/01-basic-design/example-reservation/basic-design-v1.docx` *(giả định — file mẫu không kèm)*
- `docs/02-detail-design/example-reservation/field-spec-v1.xlsx` *(giả định)*
- Figma: `docs/03-ui/example-reservation/figma-links.md` — node `123:456` *(giả định)*
- Đã tra `docs/00-glossary.md`: 予約 → reservation, 承認 → approval, 担当者 → assignee.

## Prompt for /speckit-specify
Xây màn hình cho **担当者 (assignee — người phụ trách)** duyệt một **予約 (reservation — đặt chỗ)**
đang ở trạng thái chờ. Người phụ trách xem danh sách reservation `pending`, mở chi tiết, rồi thực
hiện **承認 (approval — phê duyệt)** hoặc từ chối kèm lý do. Sau khi approval, reservation chuyển
trạng thái `approved`, gửi thông báo cho 顧客 (customer — khách hàng). Chỉ 担当者 được gán cho
reservation đó mới được approval (không cho người khác duyệt hộ).

## Ambiguities to raise in /speckit-clarify
1. Basic design nói "gửi thông báo" nhưng không rõ kênh (email / in-app / cả hai) — detail design bỏ trống.
2. Reservation bị từ chối có cho gửi lại (re-submit) không? Figma có nút "再申請" nhưng detail design không mô tả luồng.

## Thuật ngữ mới (append vào glossary)
Không có — 予約 / 承認 / 担当者 / 顧客 đều đã có trong `docs/00-glossary.md`. (Nếu có term mới, liệt kê
ở đây kèm gợi ý dịch để append thẳng vào glossary trong branch feature.)

## Suggested constitution amendments
- Cân nhắc article: "Mọi thao tác đổi trạng thái reservation phải kiểm quyền 担当者 được gán" —
  luật chung, nên đưa vào `.specify/memory/constitution.md` thay vì lặp ở từng spec.

---
Liên quan: quyết định [`2026-01-01-approval-vs-confirm`](../04-decisions/2026-01-01-approval-vs-confirm.md) ·
spec sinh ra: [`specs/000-example-reservation/spec.md`](../../specs/000-example-reservation/spec.md)
