# Bài học dự án (lessons / gotchas)

Bộ nhớ cho **những điều học được trong lúc code** mà KHÔNG thuộc về các file memory khác. Đây là loại
memory duy nhất trước đây không có nhà — nay có. Mọi agent đọc file này ở đầu `/design-to-code` (bước
"Nạp memory") để **không lặp lại lỗi cũ**.

## File này chứa gì (và KHÔNG chứa gì)

| Nếu là… | Ghi vào | KHÔNG ghi vào đây |
|---|---|---|
| Thuật ngữ nghiệp vụ (Nhật-Việt-Anh) | `docs/00-glossary.md` | ✗ |
| Nguyên tắc bất biến của dự án | `.specify/memory/constitution.md` | ✗ |
| Câu trả lời cho 1 ambiguity của `/speckit-clarify` | `docs/04-decisions/` + `INDEX.md` | ✗ |
| **Gotcha kỹ thuật / cạm bẫy / mẹo đặc thù dự án** phát hiện khi implement | **file này** | — |

Ví dụ thuộc về đây: "API khách trả `date` dạng `YYYY/MM/DD` không phải ISO", "field `status` thực ra
nullable dù detail design không nói", "môi trường staging của khách rate-limit 10 req/s", "thư viện X
version Y có bug Z, dùng workaround W". Đây là *tri thức vận hành*, không phải thuật ngữ hay nguyên tắc.

## Quy tắc

- **Append-only, 1 dòng/bài học** (ít đụng nhau khi nhiều người làm — như glossary). Mới nhất xuống dưới.
- Được **append ngay trong branch feature** (không cần PR riêng) — đây là THÊM tri thức, blast radius nhỏ.
- Nếu một bài học tiến hoá thành **nguyên tắc chung** → nâng cấp nó lên `constitution.md` (qua PR steward),
  rồi ghi chú "đã lên constitution" ở cột Ghi chú. Nếu là **thuật ngữ** → chuyển sang glossary.
- Trước khi thêm dòng mới, quét bảng xem đã có chưa (tránh trùng).

## Bảng bài học

| Ngày | Bài học (gotcha) | Nơi phát hiện (feature / file) | Ghi chú / cách áp dụng |
|---|---|---|---|
| _(xoá dòng mẫu khi bắt đầu dự án)_ | 承認 API trả `approved_at` theo giờ JST, không UTC | `000-example-reservation` · `approveReservation.ts` | Convert sang UTC ở boundary; đừng so sánh trực tiếp |
