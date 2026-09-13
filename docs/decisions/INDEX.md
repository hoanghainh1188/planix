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

| Ngày       | Quyết định                                                                                             | Ảnh hưởng tới                    | Trạng thái                    |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------- |
| 2026-09-13 | [`C12` cấm đúng thứ §6.3 cho phép](2026-09-13-c12-vs-sibling-edges.md)                                 | §6.3, §8.1 `C12`, §8.3 `N08`     | Đã xử lý, **PM nên xác nhận** |
| 2026-09-13 | [Vòng luẩn quẩn giữa §4.3 và §7.12](2026-09-13-running-work-vs-wipe-and-recompute.md)                  | §4.3, §7.12, §14.2/P6            | Đã xử lý, PM nên biết         |
| 2026-09-13 | [Bỏ qua Mốc A, đi thẳng tiếp](2026-09-13-skip-milestone-a.md)                                          | §14.3                            | PM quyết                      |
| 2026-09-13 | [WBS nhiều micro task đốt năng lực gấp ~2,7 lần](2026-09-13-micro-task-capacity-waste.md)              | §7.5, §16 giả định 3             | **Cần PM cân nhắc**           |
| 2026-09-13 | [Lễ Nhật: 3 năm gần nhất (2025–2027), không phải 3 năm tới](2026-09-13-holiday-data-jp-three-years.md) | §5.4, §14.2/P2                   | Đã chốt                       |
| 2026-09-13 | [Node tối thiểu là 22, không phải 20](2026-09-13-node-22-minimum.md)                                   | §3.1                             | Đã hoàn tất                   |
| 2026-09-12 | [Hai dự án CÓ dùng chung nhân sự — P6 nằm trong MVP](2026-09-12-shared-resources-across-projects.md)   | §16 giả định 4, §7.12, schema P1 | Đã chốt                       |
| 2026-09-12 | [`C06` kiểm hai giai đoạn: cấu trúc ở P1, đầy đủ ở P3](2026-09-12-c06-partial-at-p1.md)                | §8.1 `C06`, §14.2 P1 + P3        | Đã chốt                       |
| 2026-09-12 | [CI dùng GitHub Actions, không phải GitLab CI](2026-09-12-ci-github-actions.md)                        | §3.2, §14.2/P11                  | Đã hoàn tất                   |
| 2026-09-13 | [S4: "khớp đề xuất và chưa từng bị sửa" nghĩa là gì](2026-09-13-s4-on-track.md)                        | §10.5 lọc mặc định               | **Cần PM xác nhận**           |
| 2026-09-13 | [P9: hai chỗ §10.5 không nói, đã để nguyên](2026-09-13-p9-spec-questions.md)                           | §10.5 ràng buộc nhập liệu, §7.11 | **Cần PM quyết**              |
| 2026-09-13 | [Bỏ P10 (Excel) và chọn nền tảng triển khai](2026-09-13-skip-p10-and-platform.md)                      | §14.3 Mốc C, §13.1               | **Cần PM chốt nền tảng**      |
