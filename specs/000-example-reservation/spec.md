> ⚠️ **SPEC MẪU — XOÁ TRƯỚC KHI DÙNG THẬT.**
> File này *bình thường do `/speckit-specify` sinh ra*, không viết tay. Đây chỉ là ví dụ rút gọn để
> minh hoạ hình hài output + chuỗi traceability. Xoá cả thư mục `specs/000-example-reservation/`.

# Spec — 予約承認 (Duyệt đặt chỗ)

**Feature ID:** `000-example-reservation` (thật sẽ là `NNN-<slug>` với NNN = số issue GitHub)
**Nguồn:** [`docs/intake/000-example-reservation.md`](../../docs/intake/000-example-reservation.md)

## User story
Là **担当者 (assignee)**, tôi muốn duyệt các **予約 (reservation)** đang chờ để khách được xác nhận chỗ.

## Acceptance criteria
1. 担当者 thấy danh sách reservation trạng thái `pending` được gán cho mình.
2. Mở chi tiết → **approval** hoặc từ chối (kèm lý do bắt buộc khi từ chối).
3. Sau approval: trạng thái → `approved`, gửi thông báo cho 顧客 (customer).
4. Chỉ 担当者 **được gán** cho reservation đó mới thực hiện được — người khác nhận `403`.

## Ngoài phạm vi (đã raise ở clarify — chờ chốt)
- Kênh thông báo cụ thể (email / in-app) — xem ambiguity #1 của intake.
- Luồng 再申請 (re-submit) sau khi bị từ chối — xem ambiguity #2.

## Ghi chú thuật ngữ
Bám [`docs/00-glossary.md`](../../docs/00-glossary.md): dùng `approval` (không `confirm`) — xem
[quyết định 2026-01-01](../../docs/04-decisions/2026-01-01-approval-vs-confirm.md).
