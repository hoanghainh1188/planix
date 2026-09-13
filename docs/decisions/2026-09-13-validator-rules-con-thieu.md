# Các rule validate của §8 còn thiếu

**Ngày:** 2026-09-13
**Bối cảnh:** làm panel nối dependency (§6, §10.4)
**Trạng thái:** đã cài `N01`, `N08`, `J05`, `N02`, `N04`, `N05`, `N10`, `N03`, rồi `J03`,
`J04`, `J11` (2026-09-13). Còn `J06`, `J07`, `J08`, `N06` — nhóm cần `assignment` và calendar.

---

## Phát hiện thế nào

Panel nối task trả về phản hồi validate ngay sau mỗi lần ghi (§12.4). Khi viết test cho
phần đó, tôi khẳng định một cạnh `SF` phải sinh `N01` — §6.1 nói rõ: _"Engine chấp nhận
nhưng **luôn ghi `N01`**"_. Test đỏ. Đối chiếu lại thì `N01` chưa hề được cài.

Rà tiếp cả bảng §8.1–§8.3:

| Nhóm     | Có trong code                     | Thiếu                                      |
| -------- | --------------------------------- | ------------------------------------------ |
| Critical | C01–C12 (đủ 12)                   | —                                          |
| Major    | J01, J02, J09, J10, J12, J13, J14 | **J03, J04, J05, J06, J07, J08, J11**      |
| Minor    | N07, N09                          | **N01, N02, N03, N04, N05, N06, N08, N10** |

`N07` nằm trong `domain/dependency.ts`, `N09` nằm trong `domain/rollup.ts` — cả hai do
engine sinh lúc chạy, không phải do `validate()`. Nghĩa là `validate()` hiện chỉ cài
nhóm Critical và 7 rule Major.

Không có tài liệu nào trong `docs/` nhắc tới khoảng trống này, nên tới giờ nó vô hình.

## Vì sao không sửa luôn trong lần này

Hai lý do, không phải một.

1. **Ngoài phạm vi.** Việc được giao là màn nối task. Nhét thêm 15 rule validate vào cùng
   một PR thì phần nào hỏng cũng khó truy.
2. **`N01` làm đỏ golden test.** `wbs-500.json` và `wbs-6000.json` mỗi file có đúng một
   cạnh `SF`, và `expected.json` chụp cả `report` của import. Thêm `N01` là đổi kết quả
   kỳ vọng của hai fixture. CLAUDE.md §4 đòi việc đó phải là **một commit riêng, giải
   thích rõ vì sao** — không được đi kèm một tính năng khác.

## Tạm thời làm gì

Panel nối task tự cảnh báo `SF` ngay tại ô chọn loại quan hệ:
_"SF is rarely correct. Did you mean FS?"_ — đúng câu §6.1 yêu cầu, đặt đúng chỗ sai lầm
xảy ra.

Đây là **tấm chắn ở lớp giao diện, không phải rule engine**. Khác biệt quan trọng:

- Cạnh `SF` do importer hoặc MCP tool tạo ra vẫn KHÔNG bị ghi nhận gì.
- `ValidationReport` vẫn thiếu `N01`, nên báo cáo và `wbs_export_excel` vẫn không có nó.

Nói cách khác, cảnh báo này che đúng một đường vào trong ba đường. Nó không đóng được nợ.

## Đã làm: `N01` và `N08`

Cài ngày 2026-09-13, kèm commit riêng cập nhật golden 500 và 6.000 theo CLAUDE.md §4
(mỗi fixture có đúng một cạnh SF → một dòng `N01`; không dòng `tasks` hay `dependencies`
nào đổi).

Ghi chú khi cài:

- **"Lá" hiểu theo cấu trúc, không theo `kind`.** Một summary rỗng không có cụm nào để
  mà xếp theo cụm, nên với §6.2 nó cư xử y như một lá.
- **`N08` chồng lấn `C12`** đúng như `2026-09-13-c12-vs-sibling-edges.md` đã lường: cạnh
  lá-khác-cha sâu hơn `dependency_max_level` dính cả hai. Hai rule nói hai điều khác nhau
  về cùng một cạnh, nên để cả hai cùng báo. Nếu PM thấy ồn thì đó là chuyện của spec, sửa
  §8.3 trước rồi sửa code sau.
- **Golden không phủ `N08`**: `generate.ts` nối summary với summary, không có cạnh
  lá-sang-lá khác cha. Hiện chỉ unit test phủ. Nên bổ sung khi sinh lại fixture ở P6.

## Đã làm tiếp: `J05`, `N02`, `N04`, `N05`, `N10`

Chọn theo tiêu chí **chạy được ở đâu**: cả năm đều tính từ cây và danh sách cạnh, không
cần `schedule` hay `assignment`.

Hai chỗ đáng nhớ:

- **`N02` cố ý bỏ qua predecessor là summary.** Duration lấy từ effort theo §7.2 để rule
  chạy được ngay lúc import; nhưng effort của summary là tổng của con, còn khoảng thời gian
  nó trải ra thì chỉ biết sau khi xếp lịch. Đoán bừa ở đây sẽ cho cảnh báo sai trên đúng
  loại task mà PM khó kiểm chứng nhất.
- **`N05` báo một lần cho mỗi bản trùng, không báo cả cặp.** Hai dòng cùng tên là MỘT vấn
  đề. Báo cả hai thì PM sửa một bên rồi vẫn thấy cảnh báo còn lại và tưởng chưa xong.

`N10` bắt 2 dòng ở fixture 20 và 8 dòng ở 500/6.000 — đều là dương tính thật:
`generate.ts` đặt `sequential` cho phase chẵn đồng thời sinh cạnh FS tường minh giữa các
module anh em.

## `N03` — chưa làm, và vì sao

`N03` cùng nhóm "không cần lịch", nhưng **mọi lá trong cả ba fixture đều thiếu `phase` và
`module`**: 13 / 427 / 5.765 lá. Cài ngay thì golden 6.000 nhận thêm 5.765 dòng issue và
file kỳ vọng thành thứ không ai đọc nổi — byte-for-byte vẫn đúng về mặt kỹ thuật, nhưng
không còn ai review được diff, tức mất luôn giá trị của golden test.

Gốc rễ nằm ở `generate.ts`: nó gán `phase`/`module` cho summary cấp phase và cấp module,
nhưng không gán cho lá. Dữ liệu thật thì có (§9.2 có hai trường đó trong schema task).

**Việc cần làm trước:** sinh lại fixture. Đằng nào cũng đã nợ — CLAUDE.md §4 liệt kê vài
tình huống fixture còn thiếu (task huỷ giữa chuỗi, người làm nhiều dự án, lễ chồng nghỉ
phép, `pinned_resource` gây overallocate), và `N08` hiện cũng chưa có trong golden vì
generator chỉ nối summary với summary. Gộp `N03` vào lần sinh lại đó.

## Đã làm tiếp: `J03`, `J04`, `J11` — và sửa CHỖ validate chạy

Ba rule này cần `schedule`, nên `ValidationInput` nhận thêm `schedule`, `statusDate`,
`targetEnd`. Lịch rỗng thì chúng **im lặng**, không báo "không đạt": chưa có ngày thì chưa
kết luận được gì, và một cảnh báo sai sẽ dạy PM cách phớt lờ cả panel.

### Câu hỏi thiết kế đã có lời đáp

Ghi ở lần trước: _"`validate()` chạy TRƯỚC khi xếp lịch, nên đặt `J11` ở đó thì lượt
validate của lần recalculate sẽ đọc lịch CŨ."_

Trả lời: `scheduleProject` nay chạy validate **hai lần**. Lượt đầu là **cửa chặn** — phải
chạy trước để từ chối Critical, và nó mô tả lịch cũ. Lượt sau chạy khi lịch đã ghi xong, và
**đó mới là lượt được lưu lại**. Thêm khoảng 5 ms trên 6.000 task, rẻ hơn nhiều so với việc
PM đọc một con số không còn đúng.

Có test phân biệt được hai trạng thái đó: lượt xếp lịch ĐẦU TIÊN, khi bảng `schedule` còn
rỗng. Trước lượt ấy `J04` không thể bắt gì; sau thì có. Đã kiểm bằng cách tạm quay lại hành
vi cũ — bài test đỏ đúng như mong đợi.

### Một điều học được về `J11`

`J11` gần như **không bao giờ** xuất hiện ngay sau một lượt recalculate, và đó là đúng: §7.11
re-forecast đẩy task chưa bắt đầu ra từ mốc chuẩn, nên chúng thôi quá hạn. `J11` sống ở các
lượt validate khác — lưu tiến độ, sửa WBS — khi mốc chuẩn đã nhích lên mà lịch thì chưa tính
lại. Đó chính là câu hỏi PM đặt mỗi tuần.

Phát hiện điều này khi một bài test đặt `status_date` vào năm 2030 rồi xếp lịch: scheduler
ném `ResourceWindowExhaustedError` vì mọi thứ bị đẩy ra ngoài cửa sổ 600 ngày. Bài test sai,
nhưng nó chỉ ra đúng tính chất trên.

## Việc còn nợ

| Mức   | Còn thiếu                                            | Cần thêm gì     |
| ----- | ---------------------------------------------------- | --------------- |
| Major | `J06` resource dùng < 30%                            | `assignment`    |
| Major | `J07` lệch pha A/B > 20%                             | kết quả phân bổ |
| Major | `J08` milestone rơi ngày nghỉ                        | calendar + lịch |
| Minor | `N06` chia mỏng dưới 0.5 allocation liên tục 10 ngày | `assignment`    |

Bốn rule này cần `assignment` hoặc calendar — thứ `validate()` không nhận và cũng **không
nên** nhận: chúng là tính chất của KẾT QUẢ phân bổ, không phải của dữ liệu đầu vào. Chỗ đúng
là pipeline sau khi xếp lịch, nơi `J01` và `J14` đã nằm (`sgs.ts`).

Fixture vẫn còn nợ vài tình huống §4 (task huỷ giữa chuỗi, người làm nhiều dự án, lễ chồng
nghỉ phép, `pinned_resource` overallocate) và chưa phủ `N08`.
