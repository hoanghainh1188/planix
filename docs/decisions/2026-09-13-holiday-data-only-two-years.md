# Lễ Nhật chỉ có 2 năm từ nguồn chính thức, không phải 3

- **Ngày:** 2026-09-13
- **Trạng thái:** cần PM quyết
- **Ảnh hưởng:** `SPEC.md` §5.4, §14.2 / P2

## Vấn đề

Tiêu chí nghiệm thu P2 (§14.2) ghi:

> Seed lễ VN + JP 3 năm, gồm 振替休日.

Và §5.4 chốt: _"Lễ Nhật có ngày bù (振替休日) — nạp từ nguồn chính thức, không tự tính."_

Hai dòng này không đồng thời thoả được.

**Nguồn chính thức là 内閣府** (Cabinet Office): `www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`.
Kiểm ngày 2026-09-13: file trải từ 1955 tới **2027-11-23** và **không có dòng nào của 2028**.

Đó không phải lỗi của file. Lễ Nhật do nội các quyết định từng năm và công bố trước
khoảng một năm — 春分の日 và 秋分の日 phụ thuộc tính toán thiên văn, còn 振替休日 phụ
thuộc lễ nào rơi vào Chủ nhật. Năm thứ ba **chưa tồn tại** ở thời điểm này.

Muốn có 3 năm thì phải tự tính, mà §5.4 cấm đúng điều đó.

**Lễ Việt Nam** cũng không có nguồn máy đọc được duy nhất: Bộ luật Lao động 2019 Điều 112
định ra các ngày, nhưng Tết Âm lịch và Giỗ Tổ Hùng Vương theo âm lịch, và lịch nghỉ cụ
thể do Chính phủ công bố bằng thông báo hằng năm.

## Đã làm

Giao **cơ chế**, không giao **dữ liệu bịa**:

- `io/holiday-csv.ts` — đọc đúng định dạng CSV của 内閣府. Chỉ phân tích, **không suy
  luận**: không tự sinh 振替休日, không tự suy lễ nào rơi vào Chủ nhật.
- `db/repo/calendar-repo.ts` `importHolidays()` — nạp lễ theo từng năm, **thay cả năm**
  chứ không chèn thêm, và không đụng tới `leave` / `overtime` của cá nhân.
- Engine + cache đầy đủ, có test cho 振替休日 lấy từ dữ liệu thật.

Không commit file seed lễ nào. Dữ liệu lễ là sự thật ngoài đời; đoán sai một ngày là
lịch giao cho khách sai theo, và kiểu sai đó không ai phát hiện cho tới lúc muộn.

## Cần PM quyết

| Phương án                                   | Đánh đổi                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Chấp nhận 2 năm cho JP** (khuyến nghị) | Đúng nguồn chính thức. Mỗi năm chạy lại `import-holidays` khi 内閣府 công bố. Sửa §14.2/P2 từ "3 năm" thành "mọi năm nguồn chính thức đã công bố" |
| B. Tự tính năm thứ ba                       | Trái §5.4. 振替休日 suy được, nhưng 春分/秋分 cần tính thiên văn và có sai số                                                                     |
| C. Mua dữ liệu lịch có bảo hành             | Thêm chi phí và phụ thuộc nhà cung cấp, đổi lại có nhiều năm                                                                                      |

Với lễ VN: PM cung cấp thông báo nghỉ lễ hằng năm của Chính phủ, nạp qua cùng đường
`importHolidays`. Có thể cần một bộ đọc định dạng khác — CSV hiện tại viết cho 内閣府.

## Ghi chú kỹ thuật

File gốc mã hoá **Shift-JIS**. Giải mã sai vẫn cho **ngày đúng** (toàn ASCII) và **tên
lễ hỏng** — kiểu lỗi lặng lẽ. Đã ghi cảnh báo ngay trong `holiday-csv.ts`.
