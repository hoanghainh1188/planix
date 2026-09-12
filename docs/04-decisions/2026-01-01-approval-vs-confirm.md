> ⚠️ **QUYẾT ĐỊNH MẪU — XOÁ TRƯỚC KHI DÙNG THẬT.** Đi kèm feature mẫu `000-example-reservation`.

# 承認 dịch là "approval", không phải "confirm"
- Ngày: 2026-01-01
- Feature liên quan: `000-example-reservation`
- Câu hỏi gốc: Trong màn 予約承認, nút hành động của 担当者 nên đặt tên field/biến là `confirm` hay `approve`?
- Quyết định: Dùng **`approval` / `approve`**. Theo `docs/00-glossary.md`, 承認 = approval; "confirm"
  bị cấm vì trùng nghĩa với xác nhận email (顧客 confirm reservation của chính họ ở luồng khác).
- Người quyết định: (tên steward)

---
Nguồn ambiguity: [`docs/intake/000-example-reservation.md`](../intake/000-example-reservation.md) ·
thuật ngữ: [`docs/00-glossary.md`](../00-glossary.md)
