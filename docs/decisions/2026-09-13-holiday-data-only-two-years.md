# Lễ Nhật chỉ có 2 năm từ nguồn chính thức, không phải 3

- **Ngày:** 2026-09-13
- **Trạng thái:** ĐÃ GIẢI QUYẾT — xem mục cuối
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

---

## Giải quyết (2026-09-13, PM quyết)

**Tôi đã đọc sai §14.2.** Tôi hiểu "3 năm" là _ba năm tới_ (2026–2028) nên kết luận không
thể làm được. PM đọc là **ba năm gần nhất**, và nguồn 内閣府 có tới 2027 — tức **2025, 2026,
2027 đều có sẵn**. Tiêu chí P2 thoả được, không cần sửa spec.

Bài học: trước khi kết luận một yêu cầu bất khả thi, kiểm lại xem mình có đang đọc thêm
chữ không có trong đó không.

### Đã làm

- Seed `src/db/seed/holidays/jp-{2025,2026,2027}.json` — **54 ngày lễ**, ngày lấy nguyên từ
  nguồn chính thức.
- **Tên lễ được chuẩn hoá lại.** File gốc mã Shift-JIS, lần tải trả về 元日 thành "新年" và
  振替休日 thành "休場". Ngày là ASCII nên đúng; tên thì không tin được.
- Mỗi file là một địa điểm cho một năm. Thêm năm mới chỉ là **thả thêm một file**, không sửa
  file cũ — lịch lễ nhà nước công bố từng năm, năm đã công bố thì không nên bị đụng nữa.

### Kiểm chứng, không tin suông

Test kiểm **bằng máy** rằng mọi `振替休日` trong cả ba năm đều đứng sau một ngày lễ rơi vào
Chủ nhật, và không có `振替休日` nào rơi vào Chủ nhật. Đây là _kiểm chứng_ dữ liệu đã tải,
không phải _tự tính_ — §5.4 cấm cái sau, không cấm cái trước.

Cộng thêm: mỗi năm phải có đủ 10 ngày lễ cố định theo luật.

### Lễ Việt Nam — nhập tay

PM chốt tạm thời nhập tay. Đã dựng `vn-{2025,2026,2027}.json` với các ngày dương cố định theo
Bộ luật Lao động 2019 Điều 112 (1/1, 30/4, 1/5, 2/9), và khai `complete: false` kèm danh sách
còn thiếu: Tết Âm lịch, Giỗ Tổ Hùng Vương, ngày liền kề Quốc khánh.

`resolveSeed` **từ chối nạp** seed khai `complete: false` trừ khi người gọi truyền
`allowIncomplete` tường minh. Lý do: seed thiếu Tết trông y hệt seed đầy đủ, và engine sẽ
lặng lẽ coi 5 ngày Tết là ngày làm việc. Đó là 5 ngày công bịa ra mỗi năm mà không ai phát
hiện cho tới khi giao trễ.
