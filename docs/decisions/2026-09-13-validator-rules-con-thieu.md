# Các rule validate của §8 còn thiếu

**Ngày:** 2026-09-13
**Bối cảnh:** làm panel nối dependency (§6, §10.4)
**Trạng thái:** ghi nhận — chưa xử lý

---

## Phát hiện thế nào

Panel nối task trả về phản hồi validate ngay sau mỗi lần ghi (§12.4). Khi viết test cho
phần đó, tôi khẳng định một cạnh `SF` phải sinh `N01` — §6.1 nói rõ: _"Engine chấp nhận
nhưng **luôn ghi `N01`**"_. Test đỏ. Đối chiếu lại thì `N01` chưa hề được cài.

Rà tiếp cả bảng §8.1–§8.3:

| Nhóm     | Có trong code                     | Thiếu                                      |
| -------- | --------------------------------- | ------------------------------------------ |
| Critical | C01–C12 (đủ 12)                   | —                                          |
| Major    | J01, J02, J09, J10, J12, J13, J14 | **J03, J04, J05, J06, J07, J08, J11**      |
| Minor    | N07, N09                          | **N01, N02, N03, N04, N05, N06, N08, N10** |

`N07` nằm trong `domain/dependency.ts`, `N09` nằm trong `domain/rollup.ts` — cả hai do
engine sinh lúc chạy, không phải do `validate()`. Nghĩa là `validate()` hiện chỉ cài
nhóm Critical và 7 rule Major.

Không có tài liệu nào trong `docs/` nhắc tới khoảng trống này, nên tới giờ nó vô hình.

## Vì sao không sửa luôn trong lần này

Hai lý do, không phải một.

1. **Ngoài phạm vi.** Việc được giao là màn nối task. Nhét thêm 15 rule validate vào cùng
   một PR thì phần nào hỏng cũng khó truy.
2. **`N01` làm đỏ golden test.** `wbs-500.json` và `wbs-6000.json` mỗi file có đúng một
   cạnh `SF`, và `expected.json` chụp cả `report` của import. Thêm `N01` là đổi kết quả
   kỳ vọng của hai fixture. CLAUDE.md §4 đòi việc đó phải là **một commit riêng, giải
   thích rõ vì sao** — không được đi kèm một tính năng khác.

## Tạm thời làm gì

Panel nối task tự cảnh báo `SF` ngay tại ô chọn loại quan hệ:
_"SF is rarely correct. Did you mean FS?"_ — đúng câu §6.1 yêu cầu, đặt đúng chỗ sai lầm
xảy ra.

Đây là **tấm chắn ở lớp giao diện, không phải rule engine**. Khác biệt quan trọng:

- Cạnh `SF` do importer hoặc MCP tool tạo ra vẫn KHÔNG bị ghi nhận gì.
- `ValidationReport` vẫn thiếu `N01`, nên báo cáo và `wbs_export_excel` vẫn không có nó.

Nói cách khác, cảnh báo này che đúng một đường vào trong ba đường. Nó không đóng được nợ.

## Việc còn nợ

Hai rule dính trực tiếp tới màn vừa làm, nên làm trước:

- `N01` — cạnh SF. Kèm commit riêng regenerate `wbs-500.expected.json` và
  `wbs-6000.expected.json`.
- `N08` — task lá trỏ dependency sang lá **khác cha** (§6.3). Bổ sung cho `C12`:
  `C12` bắt cạnh sâu khác cha ở mức Critical, còn `N08` là mức nhắc nhở cho trường hợp
  cả hai đầu đều là lá. Cần đọc lại §6.3 xem hai rule có chồng nhau không **trước khi**
  cài, chứ không cài rồi mới tính.

Phần còn lại (`J03`–`J08`, `J11`, `N02`–`N06`, `N10`) là một hạng mục riêng, cần PM xếp
ưu tiên — trong đó `J11` (quá hạn so với `status_date`) đáng chú ý vì nó là thứ PM nhìn
mỗi tuần khi chốt kỳ.
