# `delay_reason` gọi sai tên nguyên nhân — `resource` và `cross_project` chưa từng xuất hiện

**Ngày:** 2026-09-14
**Phát hiện khi:** truy lại chỗ chuỗi resource-critical của GEO bị đứt
**Trạng thái:** Đã sửa. PM chốt gộp `J14` theo cặp — xem mục cuối.

## Lỗi

`sgs.ts` chỉ đặt lý do `resource` / `cross_project` khi `reason === null`:

```ts
if (best.start > earliest && reason === null) {
```

Nhưng `reason` đã được đặt thành `'dependency'` ngay phía trên nếu task có predecessor bất
kỳ đẩy nó. Mà **gần như task nào cũng có predecessor**.

Hệ quả: một task bị predecessor đẩy tới ngày X **rồi bị người hoặc dự án khác đẩy tiếp**
tới Y vẫn mang nhãn `dependency`. Nhãn chỉ đúng nửa đường, và nửa sai lại là nửa PM cần.

## Đo trên `data/dev.db`

Cùng một lệnh `scheduleAllProjects`, chỉ khác đoạn code trên:

|                         | Trước   | Sau                        |
| ----------------------- | ------- | -------------------------- |
| `dependency`            | **742** | 412                        |
| `resource`              | **0**   | **251**                    |
| `cross_project`         | **0**   | **79**                     |
| issue `J14`             | **0**   | **79**                     |
| Ngày bắt đầu / kết thúc | —       | **không đổi một dòng nào** |

Hai trong năm giá trị của §7.6 **chưa từng được phát ra**. Và §7.12 nói rõ _"Dự án ưu tiên
thấp bị đẩy → issue `J14` nêu rõ dự án nào chiếm chỗ"_ — rule đó thực tế đã chết.

Ca cụ thể: `T-0766` mang `delay_reason = 'dependency'`, `blocking_ref = 'T-0765'`. Nhưng
`T-0765` chỉ ép tới 2026-06-30; task bắt đầu 07-02 vì UTG giữ `R-00` trong 06-30..07-01.
Nay nó nói đúng: `cross_project` / `P-UTG`.

## Cách sửa và cơ sở

Bỏ điều kiện `reason === null`.

§7.6 **không nói** thứ tự ưu tiên khi hai nguyên nhân cùng áp. Nhưng mục đích nó tự nêu —
_"biến tool từ hộp đen thành thứ trả lời được câu hỏi của khách"_ — chỉ đạt được nếu nhãn
gọi tên **ràng buộc thật sự quyết định ngày bắt đầu**. Và `best.start > earliest` chính là
định nghĩa của "cận dưới do predecessor đặt ra đã không còn quyết định nữa".

Đây là **cách đọc của tôi** với một chỗ spec im lặng, không phải điều spec ghi rõ.

## Điều PM cần biết

**79 issue `J14` mức Major** nay xuất hiện ở nơi trước đó không có gì. Chúng đúng — mỗi
cái tương ứng một task thật sự bị dự án khác đẩy — nhưng đó là một thay đổi lớn trong thứ
PM nhìn thấy hằng ngày.

**PM chốt ngày 2026-09-14: gộp theo cặp (dự án chiếm chỗ, người).**

Kết quả trên `data/dev.db`: **79 → 17 issue**, và cả 79 task vẫn nằm đủ trong
`detail.taskUids` cho ai muốn đi sâu. Thông điệp nay nói thẳng cặp nào đang tranh:

> Project P-GEO holds R-09, pushing 13 tasks (earliest wanted 2026-04-13, latest actual
> 2026-06-19).

Làm việc này cũng lộ ra một chỗ hỏng lặng lẽ: pipeline **vứt mất `detail`** khi chuyển
issue từ `SgsIssue` sang `ScheduleIssue`. Không ai nhận ra vì chưa issue nào của pipeline
cần tới nó. Đã sửa cùng lúc, nếu không thì danh sách task gộp lại sẽ không tới được đâu
cả.
