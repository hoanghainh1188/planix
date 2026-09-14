# Tải nhân sự đang tính sai — `allocation` không phải tải mỗi ngày

**Ngày:** 2026-09-14
**Phát hiện khi:** làm S9 (P12)
**Trạng thái:** Đã sửa xong — cả phép tính, cả ngưỡng, cả cách phát issue.

## Triệu chứng

Màn S9 vừa dựng xong báo **10/10 người bị đặt quá tay**, có người **260%** trong một tuần
— và **200%** của con số đó đến từ **một dự án duy nhất**.

Hai dự án trong `data/dev.db` có cùng `computed_at`, tức chúng được xếp trong **một lượt**
`scheduleAllProjects` — đúng cách §7.12 quy định. Nên hoặc engine đang đặt chồng nghiêm
trọng, hoặc con số đang nói dối.

## Nguyên nhân

`assignment.from_date` / `to_date` là **bao ngoài**, không phải danh sách ngày làm.

SGS giữ chỗ trên một số ngày **cụ thể** bên trong khoảng đó:

```ts
pool.reserveDays(best.res.id, best.days, best.allocation);
assignments.push({ …, fromDate: best.start, toDate: best.end });
```

`best.days` là danh sách ngày; `best.start` / `best.end` chỉ là hai đầu mút. Những ngày
KHÔNG được giữ nằm lẫn trong khoảng mà không có dấu hiệu gì, và bảng DB **không lưu** danh
sách ngày.

Bằng chứng rõ nhất trên dữ liệu thật:

| Task     | Bao ngoài                        | `allocation` | `effort_md` |
| -------- | -------------------------------- | ------------ | ----------- |
| `T-0751` | 2026-02-12 → 03-12 (21 ngày làm) | 1.0          | **3 MD**    |
| `T-0230` | 2026-03-02 → 03-06 (5 ngày làm)  | 1.0          | **1,5 MD**  |

Nếu `allocation = 1` nghĩa là "trọn người, mọi ngày trong khoảng" thì `T-0751` phải là 21
MD chứ không phải 3.

## Đo được

Trên toàn bộ `data/dev.db`, các dự án `planning` / `active`:

|                                                                     |                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| Tổng `effort_md` thật                                               | **837,0 MD**                                     |
| Tổng tải theo cách cũ (`allocation` × mọi ngày làm trong bao ngoài) | **1047,5 MD**                                    |
| Phóng đại                                                           | **1,25×** toàn cục, tới **7×** với một task mỏng |

## Đã sửa: cách tính tải trong báo cáo

`spreadOf` trong `domain/resource-load.ts`: rải `effort_md` theo **tỷ lệ năng lực từng
ngày** trong bao ngoài.

- Tổng cộng lại **đúng bằng effort** — bất biến quan trọng nhất, và đã có test riêng.
- Ngày nghỉ nhận 0 thay vì nhận phần đều.
- Không nói được NGÀY NÀO người đó ngồi vào việc — engine biết, DB không lưu — nhưng
  **không bao giờ phóng đại tổng**.

Kiểm lại trên `dev.db` sau khi sửa: tổng tải **837,0 MD**, lệch **0,00** so với effort. Số
người bị đặt quá tay từ **10/10 xuống 0/10** khi đo cả năm, và ở mức tuần còn **4/10** với
vài tuần thật sự vượt 100% — con số dùng được.

Áp dụng cho **cả hai**: `wbs_get_resource_load` (§12.1, đã merge ở #48) và `poolLoad` mới
của S9. Hai hàm dùng chung `spreadOf` nên không thể lệch nhau.

## Rule `J06` — đã sửa phép tính (PR riêng), ngưỡng thì chưa

`checkResourceUtilisation` trong `domain/schedule-audit.ts` cũng nhân `allocation` với mọi
ngày trong bao ngoài (§8.2 `J06` — "resource dưới 30% sử dụng").

Đo trên cửa sổ `J06` thật (2026-03-02 → 2026-09-07):

| Người | Cách cũ | Cách đúng |
| ----- | ------- | --------- |
| R-03  | 83%     | **51%**   |
| R-09  | 74%     | **54%**   |
| R-04  | 60%     | 48%       |
| R-01  | 57%     | 45%       |
| …     |         |           |

Lệch **6–32 điểm phần trăm**. Trên dữ liệu demo thì **kết luận không đổi** — cả hai cách
đều báo 0 người dưới 30% — nhưng `J06` đang **phóng đại** tỷ lệ sử dụng, nghĩa là nó sẽ
**bỏ sót người đang rảnh** trên dữ liệu khác. Đó đúng là thứ §7.2 muốn nêu ra.

**Đã sửa trong một PR riêng**, đúng như `CLAUDE.md` §4 đòi: `J06` nay dùng chung
`spreadOf` với lớp báo cáo, nên hai chỗ không thể lệch nhau.

Đo lại tập issue trước/sau trên `data/dev.db`: **không đổi** — J06 = 0 ở cả hai dự án,
cả hai cách. Không file `expected.json` nào phải sửa.

### Ngưỡng: PM chốt nâng 0.3 → 0.5 ngày 2026-09-14

0.3 được hiệu chỉnh theo thước đo sai. Với thước đo đúng, `data/dev.db` cho thấy hai đội
nằm trong 41–67% — **không ai chạm 30%**, nên rule im lặng trong khi UTG có tới một nửa
năng lực chưa dùng.

Đo trước khi chọn, và phép đo lộ ra một cái bẫy: **phân bố rất chụm**. Engine san tải đều
nên UTG ai cũng 41–50%, GEO ai cũng 60–67%. Mọi ngưỡng vì thế hoặc báo **không ai**, hoặc
báo **cả đội** — không có giá trị nào phân biệt được người với người.

| ngưỡng   | UTG       | GEO   |
| -------- | --------- | ----- |
| 30% (cũ) | 0         | 0     |
| 40%      | 0         | 0     |
| **50%**  | **10/10** | 0     |
| 70%      | 10/10     | 10/10 |

### Gộp theo dự án khi cả đội cùng dưới ngưỡng

Hệ quả của cái bẫy trên: "cả đội dưới ngưỡng" là một phát hiện **mức dự án** ("dự án này
dư một nửa năng lực"), không phải mười phát hiện giống hệt nhau về mười cá nhân. PM chốt
gộp — cùng cách đã chọn cho `J14`.

Chỉ gộp khi **tất cả** người được xét đều dưới ngưỡng. Một người rảnh giữa một đội bận vẫn
được **nêu đích danh**, vì khi đó tên riêng mới là thứ dùng được.

Kết quả trên `dev.db`:

> UTG → **1 issue**: _All 10 people on this project are under 50% utilised between
> 2026-03-02 and 2026-11-17 (34%–47%)._
>
> GEO → im lặng (60–67%).
