# P9: hai chỗ §10.5 không nói, đã để NGUYÊN thay vì tự đặt luật

**Ngày:** 2026-09-13
**Phase:** P9
**Trạng thái:** **PM đã quyết** ngày 2026-09-13 — xem mục cuối

Ghi lại vì trong lúc làm P9 tôi đã tự thêm một luật validate không có trong §10.5, và nó
làm đỏ một test đã có từ P7. CLAUDE.md §8 cấm thêm thứ spec không yêu cầu, nên luật đó
đã được gỡ. Hai câu hỏi dưới đây là phần còn lại — để PM quyết, không tự suy diễn.

## 1. `actual_end` sau `status_date` có hợp lệ không?

§10.5 liệt kê ràng buộc nhập liệu:

> - `actual_end < actual_start` → chặn tại ô.
> - `actual_start > status_date` → chặn.
> - `blocked` → bắt buộc `blocked_note`.

Chỉ `actual_start` bị chặn ở tương lai, **không** nhắc `actual_end`.

- Theo mặt chữ: khai một task kết thúc **sau** mốc chuẩn là hợp lệ.
- Theo lẽ thường: báo cáo "đã xong vào một ngày chưa tới" thì cũng vô lý y như
  "đã bắt đầu vào một ngày chưa tới".

Hiện **không chặn**, đúng mặt chữ. Test `P7` đã có (`lead ghi được cho task team mình`)
lưu `actual_end = 2026-01-06` trong khi `status_date = 2026-01-05`, tức là hành vi này đã
được một test khẳng định từ trước — nên đổi nó là đổi hành vi, phải do PM quyết.

**Nếu PM muốn chặn:** thêm luật vào `validateProgressEntry`, sửa test P7 nói trên, và bổ
sung một dòng vào §10.5.

## 2. `in_progress` với `percent = 100` — có mâu thuẫn không?

Tình huống có thật, tái hiện được trên dữ liệu seed:

1. Task quá hạn → engine đề xuất `done`, 100% (§10.5).
2. Lead bấm `P` vì thực tế chưa xong.
3. Trạng thái thành `in_progress`, nhưng `percent` vẫn là 100.

Kết quả lưu xuống DB: `status = 'in_progress'`, `percent = 100`.

Điều này ảnh hưởng tới §7.11:

```
remaining_md = progress.remaining_md ?? effort_md × (1 − percent / 100)
```

`percent = 100` ⇒ `remaining_md = 0` ⇒ engine coi như không còn việc, trong khi status
nói vẫn đang làm. Rollup §7.7 cũng sẽ cộng dồn 100% cho một task chưa xong.

**Hiện không tự sửa `percent` khi đổi status**, vì:

- §7.9 nói `percent` của task thường là **nhập tay**; tự đặt lại là giành quyền của lead.
- Ô `%` hiện rõ trên màn hình nên lead nhìn thấy và sửa được.
- Mọi con số tự chọn (99? giữ nguyên? lấy lại tỷ lệ thời gian trôi?) đều là luật mới.

**Ba lựa chọn cho PM:**

| Cách                                                                    | Hệ quả                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Giữ nguyên như hiện tại                                                 | Lead phải tự nhớ sửa `%`; có thể lọt số vô lý xuống báo cáo |
| Chặn `in_progress` + `percent = 100` như lỗi nhập liệu                  | Thêm luật vào §10.5, chặn tại ô                             |
| Khi chuyển sang `in_progress`, kéo `percent` về tỷ lệ thời gian đã trôi | Ghi đè số lead có thể đã nhập tay — trái tinh thần §7.9     |

Đề xuất của tôi: **cách 2**. Nó bắt đúng lúc sai, không giành quyền nhập liệu, và giữ
cho §7.11 không bao giờ nhận `remaining_md = 0` trên một task chưa xong.

---

## PM quyết — 2026-09-13

### 1. `actual_end` sau `status_date` — **giữ như spec, KHÔNG chặn**

Đúng mặt chữ §10.5. Test P7 đang có (`lead ghi được cho task team mình`, lưu
`actual_end = 2026-01-06` khi `status_date = 2026-01-05`) vẫn đúng. Không phải sửa gì.

### 2. `in_progress` + `percent = 100` — **chặn như lỗi nhập liệu**

Đã thêm luật vào `validateProgressEntry`, chặn ngay tại ô như mọi ràng buộc khác của
§10.5, và bổ sung một dòng vào §10.5:

> `in_progress` + `percent = 100` → chặn. §7.11 sẽ suy ra `remaining_md = 0` cho một task
> chưa xong, và rollup §7.7 cộng dồn 100%. Xong thì đặt `done`, chưa xong thì hạ `%`.

UI và server dùng chung hàm đó nên hai bên không thể lệch luật nhau.
