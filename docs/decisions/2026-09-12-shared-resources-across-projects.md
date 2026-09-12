# Hai dự án CÓ dùng chung nhân sự — P6 nằm trong MVP

- **Ngày:** 2026-09-12
- **Trạng thái:** đã chốt
- **Ảnh hưởng:** `SPEC.md` §16 giả định 4, §7.12, §14.1, và thiết kế schema ở P1

## Vấn đề

`SPEC.md` §16 liệt kê bốn giả định "chỉ trả lời được sau khi chạy thật". Giả định 4:

> **Hai dự án có dùng chung người không?** Nếu không, P6 có thể hoãn sang sau MVP.

Khác ba giả định còn lại (đều là tham số cấu hình chỉnh sau được), câu này trả lời
được ngay và nó quyết định phạm vi MVP.

## Quyết định

**Có dùng chung người.** P6 (xếp lịch xuyên dự án) **nằm trong MVP**, không hoãn.

## Hệ quả — quan trọng với P1

P6 ở cuối chuỗi core nhưng ràng buộc của nó phải được tôn trọng **ngay từ P1**, vì
schema không sửa lại được sau khi có dữ liệu thật:

- `resource` là bảng **toàn cục**, không có `project_id`. §4.2 đã đúng — không được
  "đơn giản hoá" bằng cách gắn resource vào một dự án.
- `resource_team` khoá chính `(resource_id, project_id)`: một người ở nhiều team,
  mỗi dự án đúng một team (§5.1).
- Lịch năng lực (lịch A) là **toàn cục**, không thuộc dự án nào (§5.1). `capacityOn`
  trả về năng lực của người đó trong ngày, dùng chung mọi dự án — UTG chiếm 0.5 thì
  GEO chỉ còn 0.5 (§5.2).
- `assignment` không có cột project; dự án suy ra qua `task.project_id`. Truy vấn pool
  nhân sự phải quét **mọi** dự án, không lọc theo dự án hiện tại.
- `project.priority` và tie-break theo `project.code` (§7.12) phải có trong schema từ
  P1, kể cả khi P1 chưa dùng tới.

## Hệ quả với validate ở P1

- `C05` (role không có resource nào đảm nhiệm) xét trên pool **toàn cục**, không giới
  hạn trong dự án đang import.
- Fixture golden của P1 phải có **người làm nhiều dự án** — `CLAUDE.md` §4 đã liệt kê
  đây là một trong các tình huống bắt buộc của fixture.

## Ghi chú

Quyết định này đóng giả định 4 của §16. Ba giả định còn lại (`dependency_max_level`,
tỷ lệ cụm `sequential`, ngưỡng micro task) vẫn để ngỏ — đều là tham số cấu hình trong
bảng `project`, đổi được mà không sửa code.
