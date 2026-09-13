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

| Ngày       | Bài học                                                                                                                                                                                                            | Nơi phát hiện                              | Cách áp dụng                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | `typescript-eslint@8` (bản mới nhất) chỉ nhận TypeScript `<6.1.0` — chưa hỗ trợ TS 7                                                                                                                               | Phase 0 · `package.json`                   | Pin `typescript: ~6.0.3`. Chỉ lên TS 7 khi typescript-eslint công bố hỗ trợ, đừng nâng lẻ                                                                                       |
| 2026-09-12 | `npm audit` báo 2 lỗi moderate ở `uuid` qua `exceljs`. `npm audit fix --force` sẽ **hạ** exceljs xuống 3.4.0 — mất `outlineLevel` mà §11.2 bắt buộc                                                                | Phase 0 · `npm install`                    | **Không chạy** `audit fix --force`. Lỗ hổng ở uuid v3/v5/v6 khi truyền `buf`; exceljs dùng v4 không truyền `buf` → không chạm được. Rà lại khi exceljs ra bản nâng uuid         |
| 2026-09-12 | ESLint flat config: block KHÔNG có `files:` áp cho mọi file và ghi đè mọi block đứng trước nó. Đặt `disableTypeChecked` trước block `languageOptions` chung thì nó bị vô hiệu, lint vẫn lỗi parse                  | Phase 0 · `eslint.config.mjs`              | Block hẹp phải đứng SAU block rộng. Sửa config xong luôn thử bằng file probe cố tình sai — config im lặng cho qua trông giống hệt config đúng                                   |
| 2026-09-13 | Vitest 5 bỏ hẳn tính năng benchmark: không export `bench`, không có entry `vitest/bench`. Lệnh `vitest bench` vẫn chạy nhưng không tìm thấy test nào                                                               | P1 · `tests/import.bench.ts`               | Đo ngưỡng hiệu năng bằng test thường (`performance.now()` + assert), không dựa vào `vitest bench`. Đã gỡ job `bench` khỏi CI                                                    |
| 2026-09-13 | `better-sqlite3@13` cần Node >= 22. Chạy trên Node 20 thì worker vitest **SIGSEGV** ngay lúc nạp, không có thông báo nào nhắc tới phiên bản Node                                                                   | P1 · CI                                    | Giữ CI ở sàn phiên bản thật (22), không chạy sàn cao hơn máy dev. Gặp SIGSEGV ở module native thì kiểm `engines` trước khi nghi bộ nhớ                                          |
| 2026-09-13 | Nối pipeline toàn phần lộ ra thứ mọi test đơn lẻ bỏ sót: `expandSummaryEdges` nở tích Descartes (100 lá mỗi bên thành 10.000 cạnh) làm CPM 6.000 task mất 19 giây                                                  | Pipeline · `dependency.ts`                 | Dùng `expandSummaryEdgesCompact` chèn nút gộp duration 0: `                                                                                                                     | A   | +   | B   | `cạnh thay vì` | A   | ×   | B   | `. Xuống 453 ms. Mọi phép nở tích Descartes trên cây WBS đều phải nghi ngờ |
| 2026-09-13 | Fixture golden nối module tuần tự trên toàn bộ 60 module bất kể phase, nên lịch 6.000 task kéo tới 11 năm                                                                                                          | Pipeline · `tests/fixtures/generate.ts`    | Nợ fixture, sửa cùng lúc bổ sung các tình huống CLAUDE.md §4 ở P6. Đừng đọc con số đó như hành vi engine                                                                        |
| 2026-09-13 | SGS trừ chỗ CẢ DẢI `start..end` trong khi lúc đếm chỉ tính những ngày thật sự làm việc. Một người bị tính 1.25 ngày công trong một ngày, và chỉ lộ ra khi fixture có allocation trộn lẫn cộng tranh chấp           | Nợ fixture · `sgs.ts`, `resource-pool.ts`  | Phép đếm lúc xếp và phép trừ lúc ghi phải dùng CÙNG một tập ngày. `place()` nay trả về danh sách ngày, `reserveDays()` trừ đúng danh sách đó                                    |
| 2026-09-13 | `tsc` chỉ dịch `.ts` — `.sql` và `.json` nằm cạnh code KHÔNG được chép sang `dist/`. Bản build thiếu hẳn seed lễ mà toàn bộ 505 test vẫn xanh, vì vitest chạy trên `src/`                                          | Adapter · `packages/core/package.json`     | Chép theo quy tắc "mọi thứ không phải .ts" (`scripts/copy-assets.mjs`), đừng liệt kê từng thư mục — danh sách đó chắc chắn mục. Thêm `npm run smoke` chạy ĐÚNG bản build vào CI |
| 2026-09-13 | Ép kiểu kết quả tRPC về một interface chép tay (`as Promise<WbsRow[]>`) khiến `tsc` im lặng khi web và server lệch nhau. Web vẫn đọc `issueCodes` mà server không trả → màn hình trắng ngay lần chạy thật đầu tiên | Adapter · `packages/web/src/data/types.ts` | Suy kiểu từ router bằng `inferRouterOutputs<AppRouter>`, không chép tay. Mọi lệch pha thành lỗi biên dịch. Đã xoá `mock.ts` — chính nó là bản chép tay lệch đi                  |
| 2026-09-13 | tRPC kèm `stack` vào lỗi trả về khi `NODE_ENV !== 'production'`, nên một client CHƯA đăng nhập nhận được đường dẫn tuyệt đối trên máy chủ chỉ bằng một request hỏng                                                | Adapter · `router/index.ts`                | Gỡ `stack` trong `errorFormatter`, không dựa vào biến môi trường được đặt đúng. Quên đặt một lần là rò ở production                                                             |
| 2026-09-13 | CSS Grid `1fr` nghĩa là `minmax(auto, 1fr)`: track không co xuống dưới min-content. Bảng WBS rộng 58rem ghim cột trái, cả TRANG cuộn ngang và panel Issues bị đẩy khỏi màn hình 1024px                             | Adapter · `app.css`                        | Dùng `minmax(0, 1fr)` cho track chứa nội dung rộng, để việc cuộn ngang nằm trong khung cuộn của chính bảng                                                                      |
| 2026-09-13 | §7.7 nói summary tính LÚC ĐỌC, nhưng `rollupTree` chỉ làm status/percent/effort — thiếu hẳn ngày. Không test nào đỏ vì không ai đọc ngày của summary cho tới khi có màn hình thật                                  | Adapter · `rollup.ts`, `read-repo.ts`      | Bổ sung `planStart/planEnd` vào rollup và gọi rollup trong `loadWbsTree`. Khi spec nói "tính lúc đọc", đường đọc phải có test của riêng nó                                      |
