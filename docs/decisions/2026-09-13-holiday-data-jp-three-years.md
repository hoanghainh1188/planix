# Lễ Nhật: 3 năm GẦN NHẤT (2025–2027), không phải 3 năm tới

- **Ngày:** 2026-09-13
- **Trạng thái:** **Đã chốt** — PM quyết, đã cài đặt xong
- **Ảnh hưởng:** `SPEC.md` §5.4, §14.2 / P2

> **Bản này đã được sửa lại.** Bản đầu tiên của tài liệu có tên
> _"Lễ Nhật chỉ có 2 năm từ nguồn chính thức, không phải 3"_ và kết luận rằng §14.2/P2
> **không thể thoả được**. Kết luận đó **sai**, vì nó dựa trên một chỗ tôi đọc nhầm. Xem
> mục "Tôi đã đọc sai thế nào" ở cuối.

## Quyết định

Seed **3 năm gần nhất** cho lễ Nhật: **2025, 2026, 2027**. Cả ba đều lấy nguyên văn từ
nguồn chính thức, không tự tính ngày nào.

Cho phép **nạp thêm năm về sau**: mỗi năm là một file riêng, thêm năm mới chỉ là thả thêm
một file, không sửa file cũ. Lịch lễ nhà nước công bố từng năm; năm đã công bố thì không
nên bị đụng lại.

Lễ Việt Nam: **PM nhập tay**, chưa có nguồn máy đọc được.

## Đã cài đặt

- `io/holiday-csv.ts` — đọc đúng định dạng CSV của 内閣府. Chỉ phân tích, **không suy
  luận**: không tự sinh 振替休日, không tự đoán lễ nào rơi vào Chủ nhật.
- `db/repo/calendar-repo.ts` → `importHolidays()` — nạp theo từng năm, **thay cả năm** chứ
  không chèn thêm, và không đụng tới `leave` / `overtime` của cá nhân.
- `db/seed/holidays/jp-{2025,2026,2027}.json` — 54 ngày lễ, lấy từ nguồn chính thức.
- `db/seed/holidays/vn-{2025,2026,2027}.json` — chỉ các ngày dương cố định theo Bộ luật
  Lao động 2019 Điều 112 (1/1, 30/4, 1/5, 2/9), khai `complete: false` kèm danh sách còn
  thiếu: Tết Âm lịch, Giỗ Tổ Hùng Vương, ngày liền kề Quốc khánh.

### Vì sao `complete: false` lại chặn

`resolveSeed` **từ chối nạp** seed khai `complete: false`, trừ khi người gọi truyền
`allowIncomplete` tường minh.

Lý do: seed thiếu Tết trông y hệt seed đầy đủ. Engine sẽ lặng lẽ coi 5 ngày Tết là ngày
làm việc — 5 ngày công bịa ra mỗi năm, và không ai phát hiện cho tới lúc giao trễ.

### Kiểm chứng, không tin suông

Test kiểm **bằng máy** rằng mọi `振替休日` trong cả ba năm đều đứng sau một ngày lễ rơi vào
Chủ nhật, và không có `振替休日` nào rơi vào Chủ nhật. Đây là _kiểm chứng_ dữ liệu đã tải,
không phải _tự tính_ — §5.4 cấm cái sau, không cấm cái trước. Cộng thêm: mỗi năm phải có đủ
10 ngày lễ cố định theo luật.

Lưu ý khi tải lại: file CSV của 内閣府 mã hoá **Shift_JIS**. Đọc bằng UTF-8 sẽ biến
`振替休日` thành `休場` — ngày thì vẫn đúng vì là ASCII, còn tên thì không tin được.

## Còn lại

Lễ VN vẫn chưa dùng được cho tới khi PM cung cấp thông báo nghỉ lễ hằng năm của Chính phủ.
Nạp qua cùng đường `importHolidays`; có thể cần một bộ đọc định dạng khác vì bộ đọc CSV
hiện tại viết riêng cho 内閣府.

## Tôi đã đọc sai thế nào

§14.2/P2 ghi: _"Seed lễ VN + JP 3 năm, gồm 振替休日."_

Tôi đọc "3 năm" thành **ba năm sắp tới** (2026, 2027, 2028), rồi kiểm nguồn chính thức
thấy nó chỉ trải tới 2027-11-23 và không có dòng nào của 2028 — nên kết luận yêu cầu này
**bất khả thi**, và viết hẳn một tài liệu quyết định đề nghị PM sửa spec.

PM chỉ ra rằng "3 năm" nghĩa là **ba năm gần nhất**, và cả ba đều đã có sẵn trong nguồn.
Spec không hề mâu thuẫn; chỗ mâu thuẫn nằm trong cách tôi đọc.

**Bài học đã ghi vào `docs/05-lessons.md`:** trước khi tuyên bố một yêu cầu là bất khả thi,
kiểm lại xem mình có đang đọc những chữ **không có trong câu** hay không. Chi phí của việc
đọc sai kiểu này rất lệch: kết luận "bất khả thi" làm dừng cả một hướng làm và kéo PM vào
một quyết định không cần tồn tại.
