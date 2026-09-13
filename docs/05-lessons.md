# Bài học kỹ thuật (lessons / gotchas)

Nơi ghi **cạm bẫy kỹ thuật phát hiện lúc code**. Đọc trước khi bắt đầu một phase để
không giẫm lại vết cũ.

## Ghi vào đâu — ba nơi khác nhau, đừng nhầm

| Nếu là…                                                               | Ghi vào                        |
| --------------------------------------------------------------------- | ------------------------------ |
| Thuật ngữ nghiệp vụ (VI / EN / JA)                                    | `docs/00-glossary.md`          |
| Quyết định cho chỗ spec chưa rõ                                       | `docs/decisions/` + `INDEX.md` |
| Nguyên tắc bất biến của hệ thống                                      | `SPEC.md` §2 — chỉ PM sửa      |
| **Gotcha kỹ thuật, cạm bẫy thư viện, hành vi bất ngờ của môi trường** | **file này**                   |

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

| Ngày       | Bài học                                                                                                                                                                                           | Nơi phát hiện                 | Cách áp dụng                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | `typescript-eslint@8` (bản mới nhất) chỉ nhận TypeScript `<6.1.0` — chưa hỗ trợ TS 7                                                                                                              | Phase 0 · `package.json`      | Pin `typescript: ~6.0.3`. Chỉ lên TS 7 khi typescript-eslint công bố hỗ trợ, đừng nâng lẻ                                                                               |
| 2026-09-12 | `npm audit` báo 2 lỗi moderate ở `uuid` qua `exceljs`. `npm audit fix --force` sẽ **hạ** exceljs xuống 3.4.0 — mất `outlineLevel` mà §11.2 bắt buộc                                               | Phase 0 · `npm install`       | **Không chạy** `audit fix --force`. Lỗ hổng ở uuid v3/v5/v6 khi truyền `buf`; exceljs dùng v4 không truyền `buf` → không chạm được. Rà lại khi exceljs ra bản nâng uuid |
| 2026-09-12 | ESLint flat config: block KHÔNG có `files:` áp cho mọi file và ghi đè mọi block đứng trước nó. Đặt `disableTypeChecked` trước block `languageOptions` chung thì nó bị vô hiệu, lint vẫn lỗi parse | Phase 0 · `eslint.config.mjs` | Block hẹp phải đứng SAU block rộng. Sửa config xong luôn thử bằng file probe cố tình sai — config im lặng cho qua trông giống hệt config đúng                           |
| 2026-09-13 | Vitest 5 bỏ hẳn tính năng benchmark: không export `bench`, không có entry `vitest/bench`. Lệnh `vitest bench` vẫn chạy nhưng không tìm thấy test nào                                              | P1 · `tests/import.bench.ts`  | Đo ngưỡng hiệu năng bằng test thường (`performance.now()` + assert), không dựa vào `vitest bench`. Đã gỡ job `bench` khỏi CI                                            |
| 2026-09-13 | `better-sqlite3@13` cần Node >= 22. Chạy trên Node 20 thì worker vitest **SIGSEGV** ngay lúc nạp, không có thông báo nào nhắc tới phiên bản Node                                                  | P1 · CI                       | Giữ CI ở sàn phiên bản thật (22), không chạy sàn cao hơn máy dev. Gặp SIGSEGV ở module native thì kiểm `engines` trước khi nghi bộ nhớ                                  |
