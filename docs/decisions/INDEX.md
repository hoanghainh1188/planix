# INDEX — quyết định đã chốt

`SPEC.md` Phụ lục A là nơi chứa quyết định thiết kế **đã ổn định**. Thư mục này là nơi
chứa quyết định **mới phát sinh** trong lúc làm, trước khi PM gộp vào Phụ lục A.

Lý do tồn tại: `CLAUDE.md` §6 yêu cầu gặp chỗ spec chưa rõ thì hỏi PM, nhưng §8 cấm
sửa `SPEC.md` khi chưa được PM đồng ý. Nếu câu trả lời chỉ nằm trong comment PR thì
lần sau sẽ có người hỏi lại đúng câu đó. Ghi ra file để tra được.

## Quy trình

1. Gặp chỗ spec chưa rõ → tra Phụ lục A của `SPEC.md` trước, rồi tra bảng dưới.
2. Chưa có → hỏi PM.
3. PM trả lời → tạo `docs/decisions/<YYYY-MM-DD>-<slug>.md`, append 1 dòng vào bảng dưới.
4. Định kỳ PM gộp các quyết định đã ổn định vào Phụ lục A, đánh dấu `→ Phụ lục A` ở cột Trạng thái.

Append 1 dòng mỗi lần, mới nhất lên trên cùng.

| Ngày       | Quyết định                                                                                           | Ảnh hưởng tới                    | Trạng thái         |
| ---------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------ |
| 2026-09-12 | [Hai dự án CÓ dùng chung nhân sự — P6 nằm trong MVP](2026-09-12-shared-resources-across-projects.md) | §16 giả định 4, §7.12, schema P1 | Đã chốt            |
| 2026-09-12 | [`C06` kiểm hai giai đoạn: cấu trúc ở P1, đầy đủ ở P3](2026-09-12-c06-partial-at-p1.md)              | §8.1 `C06`, §14.2 P1 + P3        | Đã chốt            |
| 2026-09-12 | [CI dùng GitHub Actions, không phải GitLab CI](2026-09-12-ci-github-actions.md)                      | §3.2, §14.2/P11                  | Chờ PM sửa SPEC.md |
