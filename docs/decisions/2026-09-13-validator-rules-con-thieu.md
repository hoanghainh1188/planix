# Các rule validate của §8 còn thiếu

**Ngày:** 2026-09-13
**Bối cảnh:** làm panel nối dependency (§6, §10.4)
**Trạng thái:** `N01` và `N08` đã cài (2026-09-13). Phần còn lại vẫn chờ PM xếp ưu tiên.

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

## Đã làm: `N01` và `N08`

Cài ngày 2026-09-13, kèm commit riêng cập nhật golden 500 và 6.000 theo CLAUDE.md §4
(mỗi fixture có đúng một cạnh SF → một dòng `N01`; không dòng `tasks` hay `dependencies`
nào đổi).

Ghi chú khi cài:

- **"Lá" hiểu theo cấu trúc, không theo `kind`.** Một summary rỗng không có cụm nào để
  mà xếp theo cụm, nên với §6.2 nó cư xử y như một lá.
- **`N08` chồng lấn `C12`** đúng như `2026-09-13-c12-vs-sibling-edges.md` đã lường: cạnh
  lá-khác-cha sâu hơn `dependency_max_level` dính cả hai. Hai rule nói hai điều khác nhau
  về cùng một cạnh, nên để cả hai cùng báo. Nếu PM thấy ồn thì đó là chuyện của spec, sửa
  §8.3 trước rồi sửa code sau.
- **Golden không phủ `N08`**: `generate.ts` nối summary với summary, không có cạnh
  lá-sang-lá khác cha. Hiện chỉ unit test phủ. Nên bổ sung khi sinh lại fixture ở P6.

## Việc còn nợ

Sau `N01` và `N08`, bảng §8 còn thiếu:

| Mức   | Còn thiếu                                                                                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Major | `J03` FNLT, `J04` vượt `target_end`, `J05` task > 10 MD, `J06` resource dùng < 30%, `J07` lệch pha A/B > 20%, `J08` milestone rơi ngày nghỉ, **`J11` quá hạn so với `status_date`**           |
| Minor | `N02` lag âm quá 50% duration, `N03` lá thiếu phase/module, `N04` nhánh sâu quá 6 cấp, `N05` trùng tên cùng cấp, `N06` chia mỏng dưới 0.5 allocation, `N10` cụm sequential có cạnh tường minh |

`J11` đáng làm trước cả nhóm: đó là thứ PM nhìn mỗi tuần khi chốt kỳ, và nó chỉ cần
`schedule.end_date` với `project.status_date` — hai thứ đã có sẵn.

Một số rule cần dữ liệu mà validate hiện không nhận: `J04` cần `target_end`, `J06`/`J07`
cần kết quả phân bổ, `J08` cần lịch nghỉ, `N06` cần `assignment`. Những rule đó phải chạy
ở pipeline (sau khi xếp lịch) chứ không trong `validate()` thuần — giống cách `J01` đang
nằm trong `sgs.ts`.
