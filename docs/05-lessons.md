# Bài học kỹ thuật (lessons / gotchas)

Nơi ghi **cạm bẫy kỹ thuật phát hiện lúc code**. Đọc trước khi bắt đầu một phase để
không giẫm lại vết cũ.

## Ghi vào đâu — ba nơi khác nhau, đừng nhầm

| Nếu là… | Ghi vào |
|---|---|
| Thuật ngữ nghiệp vụ (VI / EN / JA) | `docs/00-glossary.md` |
| Quyết định cho chỗ spec chưa rõ | `docs/decisions/` + `INDEX.md` |
| Nguyên tắc bất biến của hệ thống | `SPEC.md` §2 — chỉ PM sửa |
| **Gotcha kỹ thuật, cạm bẫy thư viện, hành vi bất ngờ của môi trường** | **file này** |

Ví dụ thuộc về đây: "`better-sqlite3` chạy đồng bộ nên phải đẩy scheduler sang worker
thread", "`luxon` `plus({days})` không bỏ qua ngày nghỉ — phải đi qua `CalendarEngine`",
"thứ tự `JSON.stringify` phụ thuộc thứ tự chèn key nên golden test phải sort key trước".

## Quy tắc

- **Append-only, 1 dòng mỗi bài học.** Mới nhất xuống dưới. Append ít gây git conflict.
- Append thẳng trong branch phase, không cần PR riêng.
- Trước khi thêm, quét bảng xem đã có chưa.
- Bài học tiến hoá thành nguyên tắc chung → đề xuất PM đưa lên `SPEC.md` §2, rồi ghi
  "đã lên SPEC" ở cột Ghi chú.

## Bảng bài học

| Ngày | Bài học | Nơi phát hiện | Cách áp dụng |
|---|---|---|---|
| 2026-09-12 | `typescript-eslint@8` (bản mới nhất) chỉ nhận TypeScript `<6.1.0` — chưa hỗ trợ TS 7 | Phase 0 · `package.json` | Pin `typescript: ~6.0.3`. Chỉ lên TS 7 khi typescript-eslint công bố hỗ trợ, đừng nâng lẻ |
| 2026-09-12 | `npm audit` báo 2 lỗi moderate ở `uuid` qua `exceljs`. `npm audit fix --force` sẽ **hạ** exceljs xuống 3.4.0 — mất `outlineLevel` mà §11.2 bắt buộc | Phase 0 · `npm install` | **Không chạy** `audit fix --force`. Lỗ hổng ở uuid v3/v5/v6 khi truyền `buf`; exceljs dùng v4 không truyền `buf` → không chạm được. Rà lại khi exceljs ra bản nâng uuid |
