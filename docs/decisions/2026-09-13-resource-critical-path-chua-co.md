# Resource-critical path chưa được tính — `wbs_get_critical_path` mode `resource`

**Ngày:** 2026-09-13
**Phase:** P13 (MCP)
**Trạng thái:** CẦN PM QUYẾT

## Phát hiện

`SPEC.md` §12.1 yêu cầu `wbs_get_critical_path` nhận `mode: 'cpm' | 'resource'`.

Khi chạy thử trên `data/dev.db` (744 dòng `schedule` đã xếp lịch thật), mode `resource`
trả về **0 task**, trong khi mode `cpm` trả về 248.

Nguyên nhân không nằm ở dữ liệu. `packages/core/src/db/repo/schedule-repo.ts` ghi cứng
số `0` vào cột `is_resource_critical` cho mọi dòng:

```sql
INSERT INTO schedule
  (task_uid, es, ef, ls, lf, total_float, free_float, is_critical,
   start_date, end_date, duration_days, is_resource_critical,
   delay_reason, blocking_ref, computed_at)
VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?, ?)
--                                          ↑ hằng số
```

Không có chỗ nào khác trong `packages/core` hay `packages/server` ghi vào cột này. Nghĩa
là nó chưa bao giờ được tính, chứ không phải bị tính sai.

## Vì sao đây là lỗ hổng chứ không phải tính năng chưa tới lượt

Sơ đồ pha ở §7 đặt **C1 = "Resource-critical path"** là bước đầu của pha C. Tức là spec
CÓ yêu cầu, và pha C được coi là đã xong từ P4.

Nhưng §7 không định nghĩa **cách tính** nó. §7.2 nói rõ với pha A:

> `total_float = LS − ES`. `is_critical = (total_float == 0)`.

Pha C thì chỉ có tên bước trong sơ đồ, không có công thức. Và định nghĩa ở đây không hiển
nhiên: đường găng sau khi san tài nguyên phải tính cả **liên kết do người** (task bị đẩy
vì người bận, không vì ràng buộc) — thứ mà `sgs.ts` có ghi lại qua `delay_reason` /
`blocking_ref`, nhưng chưa ai nói là dùng nó thế nào.

Theo `CLAUDE.md` §6, chỗ này phải **dừng và hỏi PM**, không tự suy diễn rồi code tiếp.

## Đã làm gì trong P13

Mode `resource` trả về **lỗi tường minh**, không trả mảng rỗng:

> mode "resource" is not available: the scheduler does not compute the resource-critical
> path yet (SPEC §7 phase C, step C1). Use mode "cpm" for the theoretical path. An empty
> list here would mean "nothing is critical", which is not the same thing.

Lý do không trả mảng rỗng: với một con người, danh sách rỗng là dấu hiệu "chắc chưa xếp
lịch". Với một tiến trình AI đang đọc JSON, `[]` là một **câu trả lời**: "không có task
nào nằm trên đường găng thật". Đó là kết luận ngược hẳn sự thật, và nó sẽ đi tiếp vào mọi
suy luận phía sau mà không ai thấy.

Mode `cpm` hoạt động đầy đủ và đã có test.

## Câu hỏi cho PM

1. **Định nghĩa resource-critical.** Chọn một:
   - (a) Backward pass trên lịch CUỐI, chỉ theo `dependency`: task có float bằng 0 so với
     ngày kết thúc thật của dự án. Đơn giản, nhưng bỏ qua đúng thứ khiến pha B khác pha A.
   - (b) Như (a) nhưng coi cả liên kết do người là cạnh: nếu B bị đẩy vì chờ người đang
     làm A, thì A→B là một cạnh trong đồ thị. Phản ánh đúng "chuỗi thật sự quyết định
     ngày kết thúc" — và đúng thứ §7.2 gọi là chi phí thiếu người.
   - (c) Định nghĩa khác PM muốn.

2. **Làm ở phase nào.** Đây là thay đổi trong engine (pha C), nên nó sẽ làm đổi kết quả
   golden. Theo `CLAUDE.md` §4, đổi kết quả kỳ vọng phải là một commit riêng có giải
   thích. Đề xuất: một PR riêng sau P13, không nhét vào P13.

## Ảnh hưởng nếu để nguyên

- `wbs_get_critical_path` mất một nửa giá trị: câu hỏi "cái gì đang thực sự quyết định
  ngày bàn giao" chỉ trả lời được ở mức lý thuyết vô hạn người.
- §7.2 nói chênh lệch pha A ↔ pha B là "con số cần khi đàm phán thêm resource". Không có
  đường găng pha B thì chỉ so được tổng thời gian, không chỉ ra được **chuỗi nào** phải
  thêm người.
