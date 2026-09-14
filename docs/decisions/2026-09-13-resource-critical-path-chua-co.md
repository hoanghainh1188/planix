# Resource-critical path — định nghĩa và cài đặt

**Ngày:** 2026-09-13
**Phase:** P13 → cài đặt ở nhánh `feat/p13b-resource-critical`
**Trạng thái:** ĐÃ CHỐT phương án (b). Có **một câu hỏi mới** ở cuối, cần PM quyết.

## 1. Vấn đề ban đầu

`SPEC.md` §12.1 yêu cầu `wbs_get_critical_path` nhận `mode: 'cpm' | 'resource'`. Chạy thử
trên `data/dev.db`: mode `cpm` trả 248 task, mode `resource` trả **0**.

Nguyên nhân: `schedule-repo.ts` ghi **hằng số `0`** vào cột `is_resource_critical`, và
không nơi nào trong `core`/`server` tính nó — dù sơ đồ pha §7 đặt **C1 = "Resource-critical
path"** là bước đầu của pha C.

§7.2 định nghĩa rõ pha A (`is_critical = total_float == 0`), còn pha C chỉ có tên bước
trong sơ đồ, không có công thức. Theo `CLAUDE.md` §6 → hỏi PM.

## 2. PM chốt: phương án (b)

> Coi cả liên kết do người là cạnh: nếu B bị đẩy vì chờ người đang làm A, thì A→B là một
> cạnh trong đồ thị.

Lý do (b) chứ không phải (a) — (a) chỉ đi theo `dependency`: pha A đã làm đúng việc đó
rồi trên đồ thị dependency thuần. Lặp lại nó trên bộ ngày khác thì không trả lời được câu
§7.2 đặt ra. Muốn chỉ ra **chuỗi nào** phải thêm người thì chuỗi đó bắt buộc phải chứa các
mắt nối bằng người.

## 3. Cách cài đặt

`packages/core/src/domain/resource-critical.ts` — hàm thuần.

Không tính lại float bằng backward pass CPM trên lịch cuối: ngày cuối đã do SGS quyết, và
float lý thuyết trên lịch đã san tài nguyên không còn nghĩa. Thay vào đó đi **ngược từ
ngày kết thúc dự án** và hỏi ở mỗi bước: _task này bắt đầu đúng vào ngày mà predecessor
nào ép nó?_

- Mốc ép của cạnh dependency dùng **đúng công thức SGS** (`sgs.ts`, nhánh `candidate`):
  `SS` lấy mốc ngày bắt đầu của predecessor, ba loại còn lại lấy ngày làm việc kế tiếp
  sau khi predecessor xong.
- Mốc ép do người: assignment **kết thúc muộn nhất** trên cùng người mà vẫn trước ngày
  task bắt đầu.
- Mắt ràng buộc là mắt ép **đúng** ngày bắt đầu. So bằng `===`, không phải `<=`.

**Không dùng `delay_reason`.** SGS chỉ đặt `reason = 'resource'` khi `reason === null`, nên
một task bị dependency đẩy rồi bị người đẩy tiếp vẫn mang nhãn `'dependency'`. Với §7.6
nhãn đó vẫn đúng ý, nhưng dùng nó làm đồ thị sẽ bỏ sót đúng những mắt do người — thứ (b)
sinh ra để bắt.

## 4. Một lỗi đã gặp khi ghép: nút gộp làm thủng đồ thị

Thuật toán chạy đúng trên mọi ca unit nhưng cho kết quả gần như vô dụng trên dữ liệu thật:
chuỗi UTG chỉ phủ **2026-10-16 → 2026-11-27**, trong khi dự án chạy **2026-03-02 →
2026-11-27**.

Nguyên nhân nằm ở chỗ ghép, không ở thuật toán. Pipeline **gỡ nút gộp** (`~join-…`) khỏi
bản lịch trước khi ghi — đúng, vì chúng không có dòng `task`. Nhưng trong đồ thị SGS chúng
là nút thật và nhiều chuỗi đi **xuyên qua** chúng. Tính đường găng trên bản đã gỡ là tính
trên một đồ thị thủng lỗ, và mỗi chỗ thủng cắt đứt chuỗi.

Đo được: **đúng một** nút gộp trên đường đi (`~join-00028`) đã cắt chuỗi UTG từ 9 tháng
xuống còn 6 tuần cuối.

Sửa: tính trên `fullSchedule` (còn nút gộp), ghi ra DB trên `schedule` (đã gỡ).

Sau khi sửa, UTG: **261 task** resource-critical, phủ trọn **2026-03-02 → 2026-11-27**,
trong đó **138 task găng vì người mà KHÔNG găng theo CPM** — đúng thứ mode `cpm` không
thấy được.

## 5. Chuỗi đứt ở ngày lễ Nhật — PM chốt phương án (iii)

Sau khi sửa lỗi nút gộp, vẫn còn một hiện tượng, và nó **không phải lỗi**: chuỗi dừng ở
chỗ có dư thời gian thật, do **lệch lịch VN ↔ JP**.

| Dự án | Task     | Mốc ép     | Ngày bắt đầu thật | Vì sao                                           |
| ----- | -------- | ---------- | ----------------- | ------------------------------------------------ |
| GEO   | `T-0772` | 2026-07-20 | 2026-07-21        | `海の日` — người làm ở JP                        |
| UTG   | `T-0584` | 2026-09-22 | 2026-09-24        | `敬老の日` / `国民の休日` / `秋分の日` (21–23/9) |

Cả hai dự án `default_location = 'VN'` nên lag cộng theo `CAL-VN`, còn người làm ở `JP`.
Predecessor có **1–2 ngày dư thật**: dời nó một ngày thì task sau **vẫn** bắt đầu ngày cũ.
Loại nó khỏi đường găng nghĩa chặt là **đúng**.

Nhưng công cụ này sinh ra cho đội VN làm với khách Nhật, nên lệch lịch là chuyện thường
ngày. PM sẽ thường thấy "đường găng" chỉ dài vài tuần cuối.

**PM chốt (iii) ngày 2026-09-14:** giữ `is_resource_critical` nguyên nghĩa chặt để nó còn
dùng được cho tính toán, thêm một nhãn riêng cho phần bị cắt.

### Cách cài

Cột mới `schedule.is_resource_near_critical` (migration `007`). Hai cột **rời nhau**.

Định nghĩa "gần găng" **không dùng ngưỡng bằng số ngày**. Thay vào đó hỏi lịch A của
chính người làm task đó: khoảng hở `[mốc ép, ngày bắt đầu)` có **ngày làm việc nào của
người ấy** không?

- **Có** ⇒ có chỗ trống thật. Predecessor dư thời gian thật, không gắn nhãn.
- **Không** ⇒ task đã bắt đầu vào ngày sớm nhất người ấy có thể làm. "Dư" chỉ là lệch
  lịch ⇒ gắn nhãn.

Ngưỡng cứng kiểu "3 ngày" sẽ vừa bắt hụt Golden Week (dài hơn) vừa bắt nhầm một chỗ trống
thật đúng 3 ngày. Đo bằng lịch A thì không cần con số nào, và nghỉ phép cá nhân dài cũng
xử lý đúng.

`wbs_get_critical_path` mode `resource` trả **cả hai mức**, mỗi dòng mang `strict: true |
false`. Lọc sẵn chỉ mức chặt sẽ giấu mất đúng phần mà (iii) sinh ra để khỏi mất.

### Kết quả đo trên `dev.db`

| Dự án | chặt                    | gần găng              | cả hai                     | dự án         |
| ----- | ----------------------- | --------------------- | -------------------------- | ------------- |
| GEO   | 5 task, 07-21 → 07-30   | 5 task, 07-02 → 07-16 | **10 task, 07-02 → 07-30** | 03-10 → 07-30 |
| UTG   | 261 task, 03-02 → 11-27 | 1 task                | 262 task, 03-02 → 11-27    | 03-02 → 11-27 |

## 5b. ĐÍNH CHÍNH — không phải nút gộp, mà là ranh giới dự án

**Chẩn đoán cũ ở mục này SAI.** Tôi viết rằng chuỗi GEO đứt tại `~join-00012` vì nút gộp
không có người nên rule "gần găng" không bắc qua được. Truy lại tới tận cùng thì không
phải vậy.

### Vì sao chẩn đoán cũ sai

Tôi đọc nhầm chính công cụ chẩn đoán của mình. Nó chỉ in ra những mắt **KHÔNG** ràng buộc,
và tôi đếm 11 mắt rồi kết luận nút gộp chỉ có 11 predecessor. Thực ra nó có **12** — mắt
thứ mười hai (`T-0770`, xong 2026-07-16 ⇒ ép 07-17) khớp ĐÚNG ngày bắt đầu của nút gộp,
nên nó là mắt ràng buộc và vì thế không bị in ra.

Nghĩa là chuỗi **vẫn đi xuyên qua nút gộp bình thường**. Không có hạn chế nào ở đó.

### Nguyên nhân thật

Đầu chuỗi GEO là `T-0766`, bắt đầu `2026-07-02`. Mắt ép muộn nhất của nó chỉ tới
`2026-06-30`. Hai ngày chênh đó là do:

| Người `R-00`     |                   |
| ---------------- | ----------------- |
| GEO `T-0688`     | 06-23 → 06-25     |
| **UTG `T-0378`** | **06-30 → 07-01** |
| GEO `T-0766`     | 07-02 → 07-03     |

`R-00` bị **UTG** (ưu tiên 1) giữ đúng hai ngày đó. GEO là ưu tiên 2 nên bị đẩy — chính là
§7.12 đang hoạt động đúng.

`resourceCriticalPath` chỉ nhận `sgs.assignments`, tức assignment của **dự án đang xét**,
nên nó không thấy `T-0378` và không có cạnh nào để đi tiếp. Chuỗi dừng.

### Có phải lỗi không?

Không hẳn. Chuỗi của GEO dừng ở đúng chỗ GEO hết quyền kiểm soát: phần còn lại nằm trong
tay UTG. Đưa một task của UTG vào "đường găng của GEO" là một lựa chọn thiết kế, không
phải một bản sửa lỗi — nên **không tự làm**.

Thứ THẬT SỰ thiếu là lời giải thích, và nó đã được vá ở chỗ khác: xem
[`2026-09-14-delay-reason-goi-sai-ten.md`](2026-09-14-delay-reason-goi-sai-ten.md). Trước
đó `T-0766` mang nhãn `delay_reason = 'dependency'` — nói sai hẳn nguyên nhân; nay nó nói
`cross_project` / `P-UTG`.

## 6. Đã khoá lại bằng test

- `resource-critical.test.ts` — 21 ca, gồm một ca khoá **đúng** hành vi đứt chuỗi khi có
  dư thời gian, kèm giải thích vì sao không được nới `===` thành `<=`. Với (iii), ca phân
  định là hai lịch **cùng ngày tháng y hệt nhau**, chỉ khác người: người nghỉ lễ ⇒ gắn
  nhãn, người đi làm ⇒ không. Rule chỉ đếm số ngày hở sẽ không phân biệt được hai ca đó.
- `scenario.test.ts` — 5 ca mức pipeline, trong đó hai ca **đỏ lại** nếu lỗi nút gộp quay
  về (đã kiểm bằng cách tạm phục hồi lỗi).
- Test tất định so **hai DB sạch**, không phải xếp lại hai lần trên cùng DB — xếp lại lần
  hai đọc thêm assignment của dự án kia làm chỗ đã chiếm (§7.12), nên input đã khác.
