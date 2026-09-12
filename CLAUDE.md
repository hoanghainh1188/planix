# CLAUDE.md — WBS Tool

Đọc `SPEC.md` trước khi làm bất cứ việc gì. File này chỉ nói **cách làm việc**,
không lặp lại nội dung spec.

---

## 1. Năm nguyên tắc không được vi phạm

Trước mỗi PR, tự kiểm tra lại năm điều này (chi tiết ở `SPEC.md` §2):

1. **N1 — AI chỉ đứng ở hai đầu.** Không code đường nào cho phép AI hay người dùng
   ghi trực tiếp vào `schedule` / `assignment`.
2. **N2 — Deterministic.** Cấm `Math.random()`, `Date.now()` trong engine,
   và cấm dựa vào thứ tự duyệt của `Object.keys()` / `Map` / `Set`.
   Mọi so sánh phải có tie-break cuối cùng phân định được.
3. **N3 — UI không kéo thả đổi ngày.** Nếu thấy mình đang viết handler cho phép
   sửa `start_date` / `end_date`, dừng lại — đó là vi phạm.
4. **N4 — Engine không tự phá ràng buộc.** Xung đột thì sinh issue, không tự sửa.
5. **N5 — Ba nhóm bảng, ba chủ sở hữu.** Không viết code ghi chéo nhóm.

Nếu một yêu cầu nào đó buộc phải vi phạm, **dừng lại và hỏi**, đừng tự quyết.

---

## 2. Thứ tự làm việc

- Làm đúng thứ tự phase ở `SPEC.md` §14.1. **Không nhảy phase.**
- Mỗi phase một nhánh: `feat/p1-schema-importer`, `feat/p4-sgs`, …
- Kết thúc mỗi phase: chạy đủ checklist nghiệm thu ở §14.2, rồi mới xin review.
- Mỗi phase phải kết thúc bằng một bản demo chạy được, không phải code chưa ghép.

Khi bắt đầu một phase, làm theo thứ tự này:

1. Đọc lại mục spec tương ứng.
2. Viết test trước cho phần logic thuần (engine). Test dựa trên fixture có đáp án.
3. Cài đặt.
4. Chạy golden test.
5. Tự đối chiếu checklist §14.2, ghi kết quả vào PR description.

---

## 3. Quy ước code

### Ngôn ngữ

| Chỗ | Ngôn ngữ |
|---|---|
| Tên biến, hàm, kiểu, bảng, cột | Tiếng Anh |
| Comment trong code | Tiếng Anh |
| Chuỗi hiển thị trên UI | Tiếng Anh |
| `ValidationReport.message` | Tiếng Anh |
| Commit message, PR description | Tiếng Việt |
| Tài liệu trong `docs/` | Tiếng Việt |

### TypeScript

- `strict: true`. Không `any`. Không `as` trừ khi có comment giải thích.
- Kiểu ngày: dùng một branded type `DateOnly = string & { __brand: 'DateOnly' }`,
  định dạng `YYYY-MM-DD`. Không dùng `Date` trong domain layer.
- Mọi input từ ngoài (HTTP, file, MCP) đi qua `zod` trước khi vào domain.
- Domain layer (`packages/core/src/domain/`) là **hàm thuần**:
  nhận dữ liệu, trả dữ liệu, không đọc DB, không I/O.
  Repo layer lo việc đọc/ghi.

### Cấu trúc

- `packages/core` không được import gì từ `server` hay `web`.
- `packages/core` phải chạy được bằng `node` thuần, không cần HTTP server.
- Nếu thấy mình cần import ngược, thiết kế đang sai — dừng và hỏi.

### SQL

- Mọi truy vấn nằm trong `packages/core/src/db/repo/`. Không rải SQL khắp nơi.
- Dùng prepared statement. Không nối chuỗi.
- Migration là file `.sql` đánh số tăng dần, không sửa file cũ.

---

## 4. Test

### Bắt buộc

| Loại | Phạm vi | Khi nào |
|---|---|---|
| Unit | calendar, dependency, rollup, renumber | Ngay khi viết hàm |
| Golden | scheduler end-to-end, 3 bộ fixture | Từ P1, chạy trong CI |
| Permission | từng ô trong bảng §10.6 | Từ P7 |

### Golden test

- Fixture: 20 / 500 / 6.000 task, đặt ở `packages/core/tests/fixtures/`.
- Mỗi fixture có file `expected.json` đi kèm.
- So sánh **byte-for-byte**, không so sánh "gần đúng".
- Golden test đỏ = **không được merge**, kể cả khi "kết quả mới trông hợp lý hơn".
  Nếu thật sự cần đổi kết quả kỳ vọng, làm thành một commit riêng, giải thích rõ vì sao.

### Fixture phải có

- Cả bốn loại dependency, gồm lag âm.
- Cụm `parallel` và `sequential`.
- Task bị hủy ở giữa chuỗi (kiểm tra bắc cầu).
- Micro task và task thường lẫn nhau.
- Người làm nhiều dự án.
- Lễ VN chồng nghỉ phép cá nhân.
- `pinned_resource` gây overallocate.

---

## 5. Hiệu năng

Đo, đừng đoán. Ngưỡng ở `SPEC.md` §7.14.

- Viết benchmark cùng lúc với code, không để sau.
- Với 6.000 task: schedule dưới 10 giây, import dưới 5 giây, calendar cache dưới 1 giây.
- Không tối ưu sớm ở P1–P3. Nhưng **không được chọn cấu trúc dữ liệu
  khiến P4 không thể tối ưu được** — ví dụ quét tuyến tính pool nhân sự theo từng ngày.

---

## 6. Khi gặp chỗ spec chưa rõ

Làm theo thứ tự:

1. Đọc lại Phụ lục A của `SPEC.md` — có thể đã có quyết định.
2. Nếu vẫn không rõ: **dừng và hỏi PM**. Ghi câu hỏi vào PR hoặc hỏi trực tiếp.
3. Không tự suy diễn rồi code tiếp. Spec sai thì sửa spec trước, code sau.

Ngoại lệ duy nhất: chi tiết thuần kỹ thuật không ảnh hưởng hành vi
(tên biến, cách chia file, thư viện phụ). Những thứ đó tự quyết.

---

## 7. Commit và PR

### Commit

```
<phase>: <việc đã làm>

<vì sao, nếu không hiển nhiên>
```

Ví dụ: `P4: thêm tie-break cho RESOURCE_KEY bậc 3`

Một commit làm một việc. Không trộn refactor với tính năng mới.

### PR

Mở PR khi hết một phase. Nội dung gồm:

- Checklist nghiệm thu của phase đó (`SPEC.md` §14.2), tick từng dòng.
- Kết quả benchmark nếu phase có ngưỡng hiệu năng.
- Danh sách chỗ spec chưa rõ đã gặp và cách xử lý.
- Cách chạy thử demo.

Không tự merge. PM review.

---

## 8. Những việc tuyệt đối không làm

- Sửa `SPEC.md` mà không hỏi PM.
- Thêm tính năng không có trong spec, kể cả khi "làm luôn cho tiện".
- Đưa comment, board, notification, log work vào tool — đó là non-goal §1.3.
- Nới lỏng một rule validate vì nó đang báo lỗi trên dữ liệu thật.
  Rule báo đúng thì phải sửa dữ liệu, không sửa rule.
- Cache kết quả schedule ở client.
- Để một truy vấn N+1 đi qua review.
