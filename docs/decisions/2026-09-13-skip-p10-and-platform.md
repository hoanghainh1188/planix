# Bỏ P10 (Excel) và chọn nền tảng triển khai

**Ngày:** 2026-09-13
**Phase:** P10, P11
**Trạng thái:** P10 — **HOÃN** (không phải bỏ); nền tảng — **Fly.io**, PM chốt 2026-09-13

## 1. Hoãn P10 (Excel)

PM quyết **hoãn** P10 để đi thẳng tới triển khai — hoãn, không phải bỏ. P10 xếp lại ngay
**sau** P11.

**Hệ quả cần biết:** §14.3 định nghĩa **Mốc C** là _"Báo cáo dùng được cho khách"_, và
§1.2 chốt vai trò của Excel là _"tool = nơi làm việc, Excel = báo cáo một chiều"_. Excel
**là** thứ đi tới khách Nhật — §11.3 còn quy định hẳn bản tiếng Nhật có `基準日`.

Nên bỏ hẳn P10 thì **Mốc C không đạt được theo đúng câu chữ**: sau P11 sẽ có một tool
chạy được trên mạng, nhưng chưa có đường đưa số liệu ra cho khách.

**PM xác nhận ngày 2026-09-13: hoãn.** Nên §14.3 giữ nguyên, và **Mốc C chưa đạt cho tới
khi P10 xong** — sau P11 sẽ có tool chạy được trên mạng, nhưng chưa có đường đưa số liệu
ra cho khách.

## 2. Vercel KHÔNG chạy được server này

Không phải vấn đề cấu hình — là kiến trúc. Đã kiểm bằng lệnh, không suy đoán:

| planix cần                               | Serverless cho                           |
| ---------------------------------------- | ---------------------------------------- |
| Ghi file SQLite tồn tại giữa các request | Filesystem tạm, riêng từng lần gọi       |
| Một tiến trình ghi duy nhất, WAL         | Mỗi request có thể rơi vào instance khác |
| `worker_threads` chạy scheduler (§7.14)  | Hàm có giới hạn thời gian                |

**Bằng chứng chạy thật** (2026-09-13, Docker 29.7.2):

```
A. CÓ volume:    seed → container MỚI → task: 796 | lịch: 744 | user: 1
B. KHÔNG volume: seed → container MỚI → /data/project.db tồn tại? false
```

Trường hợp B chính là mô hình Vercel. Dữ liệu mất sạch sau mỗi lần khởi động lại.

Vercel chỉ hợp để phục vụ bundle tĩnh. Nhưng tách tĩnh khỏi API thì phải bật CORS và
cookie cross-origin, phá đúng thiết kế same-origin mà §13.1 chọn có chủ đích
(_"nhờ vậy không cần cấu hình CORS"_) và làm `__Host-` + `SameSite=Lax` của §13.3 không
còn dùng được như hiện tại. Tách ra là **mất** chứ không được gì.

## 3. Ba lựa chọn còn lại

| Nền tảng                   | Được                                                                                                         | Mất                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fly.io** (đề xuất)       | Volume gắn thẳng vào máy; Litestream vốn sinh ra trong hệ sinh thái này nên SQLite + sao lưu là đường đi sẵn | Bỏ Caddy → lệch §13.1 và ô checklist P11                                                                                                                                                                          |
| **Render**                 | Giao diện đơn giản, chạy thẳng image Docker                                                                  | Disk chỉ có ở gói **trả phí**; free tier mất dữ liệu mỗi lần redeploy. Service có disk chỉ chạy **một instance** (với planix thì đúng, không phải hạn chế). Sao lưu phải tự dựng nhiều hơn. Bỏ Caddy → lệch §13.1 |
| **VPS riêng** (đúng §13.1) | Khớp spec từng chữ; `deploy/docker-compose.yml` chạy được ngay                                               | Phải tự lo máy, cập nhật hệ điều hành, tường lửa                                                                                                                                                                  |

**PM chốt Fly.io ngày 2026-09-13**, và đồng ý sửa §13.1. Spec đã cập nhật: §13.1 nay nêu
hai cách (VPS có Caddy / nền tảng có quản lý), và ô checklist P11 đổi thành "HTTPS hoạt
động" thay vì gọi đích danh Caddy.

## Đã làm, không phụ thuộc lựa chọn

Image Docker và `deploy/docker-compose.yml` dùng được cho **cả ba** đường. Với Fly.io hay
Render thì bỏ khối `caddy`, giữ nguyên `app` và `litestream`.
