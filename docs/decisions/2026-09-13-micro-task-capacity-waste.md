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
