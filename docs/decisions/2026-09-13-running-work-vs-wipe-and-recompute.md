# Vòng luẩn quẩn giữa §4.3 và §7.12, và cách thoát

- **Ngày:** 2026-09-13
- **Trạng thái:** đã xử lý trong code, PM nên biết
- **Ảnh hưởng:** `SPEC.md` §4.3, §7.12, §14.2 / P6

## Vấn đề

Hai điều khoản mâu thuẫn nhau:

> §4.3 — `schedule` và `assignment` bị **xoá sạch và tính lại từ đầu** mỗi lần chạy
> engine. Không update từng dòng. Đây là điều kiện của M2.

> §7.12 — Task `done` / `in_progress` ở **mọi** dự án chiếm chỗ trước tiên, bất kể ưu
> tiên. **Việc đang chạy không bị dời.**

Nhưng thông tin _"ai đang làm task này"_ **chỉ nằm trong bảng `assignment`**. Xoá sạch
bảng đó là mất luôn thứ cần để biết việc nào đang chạy với ai.

Bỏ qua thì hậu quả không ầm ĩ mà âm thầm: mỗi lần recalculate, một người đang làm dở có
thể bị thay bằng người khác chỉ vì `RESOURCE_KEY` thấy người kia rảnh hơn. PM sẽ thấy
nhân sự nhảy loạn giữa các tuần mà không hiểu vì sao, và niềm tin vào tool mất dần — đúng
rủi ro `R5` của §15.

## Cách thoát đã dùng

Đọc `assignment` của các task `in_progress` / `blocked` **trước** khi xoá, rồi đưa người
cũ vào làm `pinned_resource` cho lượt tính mới.

Hệ quả:

- Người làm dở được giữ nguyên qua mọi lần recalculate.
- Ngày thì vẫn tính lại từ `status_date` theo §7.11 — đúng, vì phần việc còn lại phải
  được lập lịch lại.
- M2 không bị ảnh hưởng: cùng một DB đầu vào vẫn cho cùng kết quả, vì thông tin ghim
  cũng là một phần của DB đầu vào.

## Phần CHƯA làm

§7.12 nói _"ở **mọi** dự án"_. Hiện việc ghim chỉ chạy trong phạm vi dự án đang lập lịch.
Khi chạy `Recalculate all`, dự án xếp sau vẫn tôn trọng assignment của dự án xếp trước
(đã có test), nhưng **không có một lượt quét trước** để giữ chỗ cho việc đang chạy của
toàn bộ dự án ngay từ đầu.

Trong thực tế khoảng cách này nhỏ, vì thứ tự ưu tiên thường đã đặt dự án đang chạy lên
trước. Nó chỉ lộ ra khi một dự án **ưu tiên thấp** có việc đang chạy mà một dự án **ưu
tiên cao** vừa được thêm vào — khi đó việc đang chạy kia có thể bị đẩy.

Chưa làm vì nó đòi một lượt quét trước toàn cục, và lượt đó lại phải đọc `assignment`
của mọi dự án trước khi bất kỳ dự án nào bị xoá — tức phải đổi cấu trúc lệnh
`Recalculate all`. Đáng làm khi có dự án thứ ba trở lên chạy song song thật.

## Gợi ý cho PM

Nếu muốn đóng hẳn khoảng cách này, cách rẻ nhất là sửa §4.3 cho phép **giữ lại**
`assignment` của task `in_progress` thay vì xoá tất. Khi đó §7.12 thoả tự nhiên và không
cần mẹo đọc-trước-khi-xoá.
