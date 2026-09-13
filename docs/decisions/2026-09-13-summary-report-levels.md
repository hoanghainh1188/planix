# §11.3: ba cấp trên hai cột — 大項目 / 中項目 chứa gì

**Ngày:** 2026-09-13
**Phase:** P10
**Trạng thái:** **PM đã quyết** 2026-09-13 — ba cấp ba cột; §11.3 đã sửa

## Chỗ chưa rõ

§11.3 cho bản `summary` đúng **mười** cột, trong đó chỉ có **hai** cột mang phân cấp:

| Cột | Header |
| --- | ------ |
| A   | 大項目 |
| B   | 中項目 |

Nhưng ngay bên dưới lại ghi:

> Chỉ hiện tới cấp chọn trước (**mặc định 3**).

Ba cấp mà chỉ hai cột. Không có cột nào tên kiểu 小項目 hay 項目名, nên tên của task ở cấp 3
không có chỗ đứng hiển nhiên.

## Cách đọc đã chọn

| Cấp của dòng | 大項目            | 中項目                                |
| ------------ | ----------------- | ------------------------------------- |
| 1            | tên của chính nó  | trống                                 |
| 2            | tên tổ tiên cấp 1 | tên của chính nó                      |
| 3            | tên tổ tiên cấp 1 | tên của chính nó, **thụt lề một cấp** |

Nghĩa là 中項目 mang tên của chính dòng đó từ cấp 2 trở xuống, và dùng thụt lề để phân
biệt cấp 2 với cấp 3 — cách trình bày quen thuộc trong bảng biểu Nhật.

**Vì sao chọn cách này:** nó giữ được **tên của mọi dòng**. Hai cách đọc còn lại đều làm
mất thông tin:

| Cách khác                        | Mất gì                                                 |
| -------------------------------- | ------------------------------------------------------ |
| 中項目 = tên tổ tiên cấp 2       | Tên của chính dòng cấp 3 **biến mất hoàn toàn**        |
| Chỉ hiện dòng ở đúng cấp `depth` | Mất các dòng tổng ở cấp trên, trái nghĩa "gộp tới cấp" |

## Cần PM xác nhận

Bản này **đi thẳng tới khách Nhật** (§11.4), nên cách trình bày là chuyện của khách chứ
không phải chuyện kỹ thuật. Hai câu hỏi cho PM:

1. Thụt lề trong 中項目 để phân biệt cấp 2/cấp 3 có ổn với khách không, hay khách quen
   thấy mỗi cấp một cột riêng?
2. Nếu khách muốn cột thứ ba (小項目), cần PM cho tên cột đúng và bổ sung vào §11.3 —
   thêm cột là sửa spec, không tự làm được.

Đổi chỗ này rẻ: chỉ là hai biểu thức trong `io/excel/summary.ts`.

---

## PM quyết — 2026-09-13

**Ba cấp, mỗi cấp một cột.** Thêm 小項目 làm cột C; §11.3 nay có 11 cột.

| Cấp của dòng | 大項目           | 中項目           | 小項目           |
| ------------ | ---------------- | ---------------- | ---------------- |
| 1            | tên của chính nó | —                | —                |
| 2            | tổ tiên cấp 1    | tên của chính nó | —                |
| 3            | tổ tiên cấp 1    | tổ tiên cấp 2    | tên của chính nó |

Cách thụt lề trong 中項目 mà tôi cài ban đầu đã bị thay. Cách mới đọc thẳng hơn với khách,
và mỗi cột mang đúng một nghĩa.

**Hệ quả:** bản summary hiện được **tối đa 3 cấp**, vì có đúng ba cột phân cấp. `depth`
ngoài khoảng 1–3 nay bị **từ chối** kèm thông báo rõ, thay vì lặng lẽ dồn cấp 4 vào cột
cấp 3 — dồn như thế thì khách đọc ra một cây sai mà không có dấu hiệu nào.
