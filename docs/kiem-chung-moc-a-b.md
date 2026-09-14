# Kiểm chứng Mốc A và Mốc B

**Ngày soạn:** 2026-09-14
**Căn cứ:** `SPEC.md` §1.1 (M4), §14.2 (P4, P9), §14.3, §15.1;
[`decisions/2026-09-13-skip-milestone-a.md`](decisions/2026-09-13-skip-milestone-a.md)

## Vì sao có tài liệu này

Code đã tới P14, nhưng hai cửa kiểm chứng bằng người của §14.3 chưa mở:

| Mốc | Câu hỏi | Trạng thái |
|---|---|---|
| **A** | Lịch engine tính ra, PM có tin không? | PM quyết bỏ qua; quyết định ghi *"vẫn nên làm khi thuận tiện"* |
| **B** | Lead có chịu dùng không — dưới 30 phút mỗi tuần? | Chưa làm |

M1–M3 đo được bằng test và đang xanh. **M4 chưa có bằng chứng nào.** §14.3 ghi hậu quả nếu
trượt Mốc B: *"quay lại bàn về độ mịn WBS"* — tức là giả định 0.25 MD (Phụ lục A #19) sai, và
phần xây trên nó phải tính lại. Nên hai mốc này đứng trước mọi tính năng mới.

Không test nào thay được hai việc dưới đây. Tài liệu chỉ để buổi kiểm chứng không phí thời
gian của người thật.

---

## Mốc A — PM đọc lịch một lượt

**Ai:** PM. **Bao lâu:** khoảng 15 phút. **Cần:** `data/dev.db` hoặc dữ liệu thật.

Mục đích không phải tìm bug — test đã lo phần công thức. Mục đích là **phán đoán nghề nghiệp**:
lịch này có giống thứ một PM có kinh nghiệm sẽ tự xếp không.

### Nhìn vào đâu

1. **S3 Gantt, cả dự án.** Ngày kết thúc có hợp lý so với khối lượng không? `J07` báo
   *"Resource limits stretch the schedule X% beyond the ideal plan"* — con số X có khớp cảm
   giác của bạn về độ thiếu người không?
2. **Chọn ba task bị đẩy muộn nhất** (S1, cột Plan Start) và xem `delay_reason` của chúng.
   Lý do engine đưa ra có đúng là lý do bạn sẽ nói không?

   **Lưu ý:** `delay_reason` hiện **chưa hiện trên màn web nào** — engine tính và lưu nó,
   `wbs.tree` có trả về, nhưng không component nào vẽ ra. Tạm thời xem qua MCP
   (`wbs_explain_task`) hoặc đọc thẳng cột `schedule.delay_reason`. Đây là lỗ hổng thật so
   với §7.6 và R5 (*"`delay_reason` … là bắt buộc"*), không phải chi tiết giao diện: không
   có nó thì chính bước kiểm này khó làm.
3. **Đường găng.** Chuỗi task tô đậm có phải chuỗi bạn thật sự lo không? Có chuỗi nào bạn lo
   mà engine không tô?
4. **Issue `J14`** (tranh người xuyên dự án). Dự án ưu tiên thấp bị dự án nào chặn, ở người
   nào? Có hợp với cách bạn sẽ phân xử không?
5. **Một người cụ thể trên S9 Pool.** Tải của họ theo tuần có giống thực tế không?

### Kết luận

| Kết quả | Việc tiếp |
|---|---|
| Hợp lý, có sai lệch nhỏ giải thích được | Ghi lại sai lệch vào `decisions/`, đóng Mốc A |
| Có chỗ sai **ở khái niệm** (engine xếp theo logic khác cách PM nghĩ) | **Dừng tính năng mới.** Ghi lại, bàn trước khi làm tiếp |

Ghi kết quả vào một file trong `docs/decisions/`, kể cả khi kết luận là "ổn".

---

## Mốc B — lead nhập tiến độ một tuần thật

**Ai:** một team lead thật, không phải PM đóng vai. **Bao lâu:** một buổi nhập tiến độ
bình thường của họ. **Ngưỡng:** dưới 30 phút (§14.3, §1.1 M4).

### Dữ liệu demo KHÔNG dùng được cho Mốc B

Đo trên `data/dev.db` ngày 2026-09-14, đếm task lá mà lead phải xử lý ở S4:

| `status_date` | GEO | UTG |
|---|---|---|
| 2026-03-02 (hiện tại) | 1 | 1 |
| 2026-03-09 (+1 tuần) | 5 | 5 |
| 2026-03-16 (+2 tuần) | 8 | 8 |
| 2026-04-06 (+5 tuần) | 80 | 18 |

Gọi thẳng `progress.board` bằng tài khoản `U-LEAD` (lead GEO) ở mốc hiện tại: 59 dòng, **0
dòng cần xử lý**. Mở S4 ra là không có gì để nhập.

§10.5 thiết kế cho quy mô *"từ 300 dòng xuống 20–40 dòng thật sự cần nhìn"*. Dữ liệu demo
không có tuần nào ở quy mô đó, nên đo trên nó chỉ chứng minh được là màn hình mở được —
không chứng minh được M4. §14.2/P9 cũng ghi rõ **"Đo thật"**.

### Điều kiện trước buổi đo

- [ ] Một dự án **thật**, WBS thật do AI sinh và import (§9), độ mịn đúng 0.25 MD.
- [ ] Đã chạy Recalculate, không còn Critical.
- [ ] `status_date` đặt ở **cuối một tuần làm việc thật** mà team của lead đã làm.
- [ ] Tài khoản lead do **admin tạo bằng CLI** (`npm run cli -- create-user`, rồi `grant` vai
      `lead` kèm team). Mật khẩu do admin và lead tự đặt — không tạo sẵn hộ.
- [ ] Lead đã làm xong tuần đó, và **chưa** cập nhật tiến độ ở đâu khác cho tuần này.
- [ ] Không hướng dẫn trước quá năm phút. Giả định cần kiểm chính là lead tự dùng được.

### Đo gì

| Chỉ số | Cách đo | Ngưỡng cảnh báo (§15.1) |
|---|---|---|
| **Thời gian** | Bấm giờ từ lúc mở S4 tới lúc lưu xong lần cuối. Tính cả thời gian ngồi đọc | > 30 phút |
| **Số dòng phải nhìn** | Số dòng hiện ra trước khi bấm "expand" nhóm on-track | kỳ vọng 20–40 |
| **Tỷ lệ sửa khác đề xuất** | Đếm tay: bao nhiêu dòng lead đổi so với giá trị xám đề xuất | > 40% |
| **Chỗ vấp** | Ghi lại mọi lúc lead dừng lại, hỏi, hoặc làm sai rồi sửa | — |

Chỉ số thứ ba **phải đếm tay**: đề xuất được tính ở trình duyệt và không được lưu, nên hệ
thống chưa tự tính được con số này (xem mục "Chưa đo tự động được" dưới).

### Hỏi lead sau buổi đo

1. So với cách báo tiến độ hiện tại (chat, Jira, Excel), cái này nhanh hơn hay chậm hơn?
2. Có dòng nào bạn phải sửa mà thấy đáng lẽ engine đoán đúng được không?
3. Tuần sau bạn có tự mở ra nhập không, nếu không ai nhắc?

Câu 3 quan trọng nhất. §15.1 cảnh báo khi một lead **hai tuần liên tiếp không nhập**.

### Kết luận

| Kết quả | Việc tiếp |
|---|---|
| Dưới 30 phút, lead nói sẽ tự dùng | Đóng Mốc B. Lặp lại vào tuần thứ hai để chắc không phải may |
| Dưới 30 phút nhưng tỷ lệ sửa > 40% | Luật đề xuất §10.5 sai với thực tế — xem lại trước khi mở rộng |
| Trên 30 phút | **§14.3: quay lại bàn về độ mịn WBS.** Không làm tính năng mới cho tới khi bàn xong |

Ghi kết quả — con số thật, không làm tròn — vào `docs/decisions/`.

---

## Chưa đo tự động được

§15.1 muốn ba chỉ số này hiện thường trực trên màn hình PM. Hiện trạng:

| Chỉ số | Tự động được chưa | Vì sao |
|---|---|---|
| Số tuần liên tiếp không nhập | Tính được từ `audit_log` | `progress.save` đã ghi `recordUpdate('progress', …)` |
| Phút/tuần ở S4 | Chỉ xấp xỉ | Không có đo thời gian; dấu thời gian đầu–cuối bỏ sót lúc ngồi đọc |
| Tỷ lệ sửa khác đề xuất | Chưa | Đề xuất tính ở `packages/web/src/model/progress-model.ts`, không gửi lên server |

Vì vậy buổi đo Mốc B đầu tiên **đo tay**. Chỉ nên làm màn §15.1 **sau** khi Mốc B cho biết
chỉ số nào thật sự đáng theo dõi — làm trước là xây thêm lên một giả định chưa kiểm.
