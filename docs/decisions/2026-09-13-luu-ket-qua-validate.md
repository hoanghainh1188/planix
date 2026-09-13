# Lưu kết quả validate xuống DB — màn S6 sống lại

**Ngày:** 2026-09-13
**Ảnh hưởng:** §8, §10.4 (chấm đỏ), S6
**Trạng thái:** Đã làm — **hai chỗ PM cần xác nhận**, đánh dấu ở cuối

---

## Vấn đề

`validation_issue` có trong schema từ P1. Không dòng mã production nào ghi vào nó — chỉ
test mới insert. Validate vẫn chạy đủ ba chỗ §8 nói, nhưng report trả về cho người gọi
rồi bị vứt.

Hệ quả trên màn hình:

- Panel Issues (S6) **luôn trống**, mọi dự án, mọi lúc.
- Chấm đỏ §10.4 trên cây WBS **không bao giờ hiện**.

Dự án demo đang chạy có `C01` và `C11` thật, mà panel vẫn hiện `Critical 0 · Major 0 ·
Minor 0`. Panel không chỉ vô dụng — nó nói sai.

## Ghi ở đâu

Đúng ba chỗ §8 liệt kê:

| Chỗ               | Ghi khi nào                               | Ghi chú                            |
| ----------------- | ----------------------------------------- | ---------------------------------- |
| `importTasks`     | chỉ khi nạp **thành công**                | trong cùng transaction với dữ liệu |
| `scheduleProject` | cả khi **thành công** lẫn khi **bị chặn** | xem dưới                           |
| `progress.save`   | sau khi lưu, trong cùng transaction       | theo từng dự án trong lô           |

**Import hỏng thì KHÔNG ghi.** §9.3 cho rollback toàn bộ, nên task vừa nạp biến mất;
issue trỏ vào uid của chúng sẽ là rác trỏ vào hư không, và panel sẽ tố cáo dự án theo
lỗi của một lần nạp chưa từng xảy ra. Người gọi vẫn nhận đủ report qua
`ImportValidationError`.

**Schedule bị chặn thì VẪN ghi**, và đây là ca quan trọng nhất của cả việc này. Bị chặn
là đúng lúc PM cần biết vì sao nhất. Khác với import, ở đây không có gì bị rollback —
task vẫn nguyên, chỉ là lịch không được tính. `recordValidationRun` mở transaction riêng
nên vết chẩn đoán ở lại kể cả khi lượt chạy không ghi được dòng lịch nào.

Lượt schedule gộp **hai nguồn** issue: `validate()` trên dữ liệu đầu vào, và issue chỉ
lộ ra khi xếp lịch (`N07` bắc cầu hỏng, `J01` overallocate, `J14` bị dự án ưu tiên cao
đẩy). Với PM đọc màn S6 thì cả hai đều là vấn đề của dự án, không phải hai loại dữ liệu.

## Lượt mới THAY lượt cũ

Hai lý do:

1. Người đọc duy nhất (`loadIssues`, `loadWbsTree`) đều chỉ lấy run mới nhất. Giữ run cũ
   là giữ dữ liệu không ai đọc.
2. Số issue tỷ lệ với số task. Một dự án 6.000 task thiếu `role` sinh 6.000 dòng `C04`
   **mỗi lượt**. Cộng dồn qua từng lần bấm Recalculate thì bảng phình vô hạn.

Vết ai-sửa-gì vẫn nằm ở `audit_log`; đây là bảng trạng thái, không phải bảng lịch sử.

## Bảng mới: `validation_run` (migration 004)

Phát hiện khi làm UI: `validation_issue` rỗng **không phân biệt được** hai trạng thái mà
panel buộc phải phân biệt.

- dự án **sạch** — đã kiểm, không có vấn đề nào
- dự án **chưa ai kiểm** — chưa từng import, schedule hay lưu progress

Cả hai cho ra không dòng nào. Panel hiện "No issues found" cho trường hợp thứ hai là nói
sai: nó không phải "không có vấn đề" mà là "chưa biết". Hai câu đó dẫn PM tới hai quyết
định khác nhau.

Nên thêm bảng một-dòng-mỗi-dự-án ghi lại lượt gần nhất: `run_id`, `ran_at`, và số issue
theo từng mức. Panel nay có ba trạng thái rỗng khác nhau, không phải một.

## Panel nói rõ "as of"

Issue là **ảnh chụp tại một thời điểm**, không phải trạng thái tức thời. Sửa WBS xong thì
danh sách đã cũ cho tới lần validate kế tiếp. Panel ghi `as of <thời điểm>` để PM biết
mình đang đọc ảnh chụp lúc nào.

## Hai chỗ PM cần xác nhận

**1. Có cần lịch sử issue không?** Hiện lượt mới xoá lượt cũ, nên không trả lời được câu
"issue này xuất hiện từ bao giờ". Không màn nào trong §10 đòi hỏi điều đó, và chi phí
giữ lịch sử là bảng phình theo số task × số lần bấm Recalculate. Nếu PM muốn, cách rẻ
nhất là giữ `validation_run` (đã có, mỗi dự án một dòng) và thêm cột đếm theo thời gian,
chứ không giữ từng dòng issue.

**2. Sửa WBS có nên validate lại ngay không?** §8 chỉ liệt kê ba chỗ: import, schedule,
lưu progress. Nên sau khi PM sửa task, đổi cha, nối/gỡ ràng buộc, panel **vẫn hiện ảnh
chụp cũ** cho tới lần schedule kế tiếp. Đã làm đúng theo spec và ghi rõ "as of" để không
gây hiểu nhầm. Nhưng nếu PM thấy khó chịu thì mở rộng ra mọi thao tác ghi là việc nhỏ —
đo trên fixture 6.000 task, một lượt validate hết 5,4 ms.

Riêng nối/gỡ ràng buộc thì §12.4 đã có phản hồi validate **ngay tại panel Links**, nên
chỗ đó không bị mù.
