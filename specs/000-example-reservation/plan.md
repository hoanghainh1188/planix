> ⚠️ **PLAN MẪU — XOÁ TRƯỚC KHI DÙNG THẬT.**
> File này *bình thường do `/speckit-plan` sinh ra*, không viết tay. Đây chỉ là ví dụ rút gọn để
> minh hoạ hình hài output + cách plan trỏ xuống layout `src/features/<slug>/`.
> Xoá cả thư mục `specs/000-example-reservation/`.

# Plan — 予約承認 (Duyệt đặt chỗ) · `000-example-reservation`

**Nguồn:** [`spec.md`](spec.md) · [`docs/intake/000-example-reservation.md`](../../docs/intake/000-example-reservation.md)

## Cách tiếp cận
Tách **domain logic thuần** (không I/O) khỏi tầng vận chuyển để test được ở mức unit — đúng Article W
(TDD + coverage ≥ 80% business logic). Quyền `担当者` (assignee) và chuyển trạng thái `予約`
(reservation) là *business rule*, phải nằm trong hàm thuần, không rải trong controller.

## Cấu trúc file (theo `src/features/<slug>/` — xem `CLAUDE.md`)

```
src/features/example-reservation/
├── approveReservation.ts        # hàm thuần: kiểm quyền assignee + chuyển pending→approved
└── approveReservation.test.ts   # unit test cạnh code (RED→GREEN→refactor)
```

Tầng vận chuyển (route/controller, gửi thông báo 顧客) *ngoài phạm vi bản mẫu này* — mẫu chỉ minh hoạ
domain core + test để bạn thấy hình dạng một feature cô lập.

## Thuật ngữ (bám `docs/00-glossary.md`)
`reservation` (予約) · `approval`/`approve` (承認 — **không** `confirm`, xem
[quyết định 2026-01-01](../../docs/04-decisions/2026-01-01-approval-vs-confirm.md)) · `assignee` (担当者) · `customer` (顧客).

## Rủi ro / phụ thuộc
- 2 ambiguity chưa chốt (kênh thông báo; luồng 再申請) — xem `spec.md` mục "Ngoài phạm vi".
- Chưa chọn kênh thông báo → tầng gửi thông báo chưa implement, chỉ để hook trống.
