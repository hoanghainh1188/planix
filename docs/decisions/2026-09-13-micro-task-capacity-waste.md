# WBS nhiều micro task đốt năng lực gấp ~2,7 lần lượng việc thật

- **Ngày:** 2026-09-13
- **Trạng thái:** phát hiện khi chạy pipeline toàn phần, **cần PM cân nhắc**
- **Ảnh hưởng:** `SPEC.md` §7.5, §16 giả định 3, tham số `default_max_parallel`

## Phát hiện

Chạy đường ống đầy đủ trên fixture 6.000 task, 30 người:

|                     |                                     |
| ------------------- | ----------------------------------- |
| Tổng khối lượng     | 12.552 MD                           |
| Gói kín lý thuyết   | 12.552 / 30 = **418 ngày làm việc** |
| Lịch engine tính ra | **~1.140 ngày làm việc**            |
| Hiệu suất           | **~37%**                            |

Bỏ **hết** dependency vẫn ra con số đó, nên không phải do chuỗi phụ thuộc.

## Nguyên nhân — engine làm đúng spec

§7.5 ràng buộc mỗi cặp (người, ngày) bằng hai điều kiện:

```
Σ allocation của task đang chạy  ≤  capacityOn(resource, date)
số task đang chạy                ≤  resource.max_parallel
```

Điều kiện thứ hai là điểm nghẽn. Với `max_parallel = 2`, một người mỗi ngày nhận tối đa
**2 task**, bất kể task đó nhỏ đến đâu. Hai task 0,25 MD dùng hết suất trong ngày trong
khi chỉ tiêu **0,5 ngày công** — nửa ngày còn lại không ai dùng được.

Fixture có bảng effort `[0.25, 0.5, 1, 2, 0.5, 3, 0.25, 1.5]`: **4 trên 8 là micro task**
(≤ 0,5 MD theo ngưỡng mặc định). Đó là lý do hiệu suất tụt xuống 37%.

Đây không phải lỗi cài đặt. Không có điều kiện `max_parallel` thì một người có thể bị
giao 8 task 0,25 MD trong một ngày, và §7.5 nói rõ lý do không muốn thế: _"Chia mỏng làm
tăng context switching. Engine không mô hình hóa được chi phí đó nên mặc định tránh."_

## Vì sao đáng quan tâm ngay

§16 giả định 3 đặt câu hỏi _"ngưỡng micro task 0,5 MD có hợp lý không"_ và dự kiến trả
lời sau khi chạy thật. Phát hiện này cho thấy câu hỏi đó còn kéo theo một hệ quả về
**năng lực**, không chỉ về cách đo tiến độ: WBS càng mịn thì lịch càng dài một cách giả
tạo, và PM sẽ thấy dự án cần gấp đôi người so với phép tính MD thông thường.

§1.5 chốt độ mịn task lá là 0,25 MD, nên đây không phải trường hợp hiếm.

## Cần PM cân nhắc

| Phương án                                       | Đánh đổi                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **A. Nâng `default_max_parallel`** (ví dụ 4)    | Đơn giản, chỉ là tham số trong bảng `project`. Đổi lại chấp nhận chia mỏng hơn, đúng thứ §7.5 muốn tránh |
| B. Cho micro task không tính vào `max_parallel` | Đúng trực giác: 4 task 0,25 MD là một ngày việc, không phải 4 lần chuyển ngữ cảnh. Nhưng phải sửa §7.5   |
| C. Giữ nguyên                                   | Lịch dài là phản ánh trung thực chi phí chuyển ngữ cảnh, nếu PM tin rằng chi phí đó có thật              |

Không có phương án nào sai rõ ràng — nó phụ thuộc chi phí chuyển ngữ cảnh thật của team,
thứ mà chỉ PM và team lead biết.

## Ghi chú

Con số trên đo trên **fixture tổng hợp**, nơi tỷ lệ micro task do tôi chọn khi sinh dữ
liệu. Dữ liệu thật có thể lệch nhiều. Nên đo lại trên WBS thật đầu tiên trước khi đổi
tham số.

---

## PM quyết — 2026-09-13

**Chọn phương án A: nâng `default_max_parallel` từ 2 lên 4.**

Đã cài đặt ở `003_max_parallel_default.sql`. SQLite không có
`ALTER TABLE ... ALTER COLUMN SET DEFAULT`, nên migration phải **dựng lại bảng `project`**:
chỉ `UPDATE` các dòng hiện có thì dự án tạo mới về sau vẫn nhận 2 — một cái bẫy im lặng.

Phép dựng lại đòi `PRAGMA foreign_keys = OFF`, vì `DROP TABLE` khi FK đang bật sẽ chạy
`DELETE FROM` ngầm và **kích hoạt `ON DELETE CASCADE`** — tức xoá sạch task, dependency,
schedule. Pragma đó lại bị bỏ qua khi đang trong transaction, nên `migrate()` được mở rộng
để migration đánh dấu `-- planix:no-transaction` tự lo giao dịch của mình.

Dự án đã được chỉnh tay sang giá trị khác thì **giữ nguyên**, không bị đè.

### Đo lại sau khi đổi

Golden test **không đổi một byte**. Đó không phải dấu hiệu thay đổi vô hiệu, mà vì fixture
golden bị chặn bởi **dependency** chứ không phải năng lực người — `max_parallel` chưa bao
giờ là ràng buộc quyết định ở đó.

Tác dụng thật đo bằng một fixture khác (`maxparallel-effect.test.ts`): 200 micro task
0,25 MD, không phụ thuộc nhau, trên 5 người — tức chỉ năng lực người mới giới hạn. Với
`max_parallel = 4` lịch kết thúc **sớm hơn hẳn** so với 2, và số task một người chạy trong
một ngày bị chặn đúng bằng tham số (§7.5).

**Vẫn nên đo lại trên WBS thật đầu tiên.** Con số 2,7× ban đầu đo trên fixture tổng hợp,
nơi tỷ lệ micro task do tôi chọn khi sinh dữ liệu.
