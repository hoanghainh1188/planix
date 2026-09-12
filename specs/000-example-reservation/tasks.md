> ⚠️ **TASKS MẪU — XOÁ TRƯỚC KHI DÙNG THẬT.**
> File này *bình thường do `/speckit-tasks` sinh ra*, không viết tay. Ví dụ rút gọn minh hoạ cách
> task ánh xạ 1-1 với acceptance criteria trong `spec.md`. Xoá cả thư mục `specs/000-example-reservation/`.

# Tasks — 予約承認 (Duyệt đặt chỗ) · `000-example-reservation`

**Nguồn:** [`spec.md`](spec.md) · [`plan.md`](plan.md)

Mỗi task ghi kèm acceptance criteria (AC) mà nó thoả. TDD: viết test trước (RED) rồi implement (GREEN).

- [x] **T1** — `src/features/example-reservation/approveReservation.ts`: hàm thuần nhận `reservation`
      + `actorAssigneeId`, chuyển `pending` → `approved`. *(AC 2, 3)*
- [x] **T2** — Chặn người **không phải** `担当者` được gán: ném lỗi `Forbidden` (→ `403` ở tầng route). *(AC 4)*
- [x] **T3** — Từ chối bắt buộc kèm lý do: thiếu `reason` khi `reject` → lỗi validation. *(AC 2)*
- [x] **T4** — Unit test `approveReservation.test.ts` phủ AC 2/3/4 + nhánh lỗi (RED trước, GREEN sau). *(Article W)*
- [ ] **T5** — Tầng route + gửi thông báo `顧客`: **treo** — chờ chốt kênh thông báo (ambiguity #1). *(AC 3, phần thông báo)*
- [ ] **T6** — Luồng `再申請` (re-submit) sau khi bị từ chối: **treo** — chờ chốt (ambiguity #2).

> T5/T6 để `[ ]` có chủ đích: minh hoạ cách task treo lại chờ `/speckit-clarify`, thay vì tự bịa hành vi.
