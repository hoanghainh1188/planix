# Thuật ngữ dự án (English / Tiếng Việt / 日本語)

Bảng này có hai công dụng, đừng nhầm lẫn:

1. **Đặt tên trong code.** Cột English là tên dùng trong biến, hàm, bảng, cột DB.
   `CLAUDE.md` §3 chốt: code và UI tiếng Anh. Tra bảng trước khi đặt tên nghiệp vụ mới.
2. **Dịch báo cáo Excel.** `SPEC.md` §11 cho báo cáo tham số `lang`: `en` / `ja` / `vi`.
   Bản `summary` mặc định tiếng Nhật và đi thẳng tới khách — sai thuật ngữ ở đây là lỗi lộ ra ngoài.

Gặp thuật ngữ mới → append 1 dòng ngay trong branch phase, không tự dịch rồi bỏ qua.

## Thực thể chính

| English (code) | Tiếng Việt | 日本語 | Ghi chú |
|---|---|---|---|
| task | công việc | タスク | Đơn vị của cây WBS |
| summary | task tổng | サマリ / 大項目 | `kind='summary'`. Không có dữ liệu riêng, mọi thứ rollup từ con (§7.7) |
| work | task thực thi | 作業 | `kind='work'`. Bắt buộc có `role` và `effort_md > 0` |
| milestone | mốc | マイルストーン | `effort_md = 0` là mốc thuần; `> 0` thì gán người như task thường (§7.10) |
| micro task | task nhỏ | 微小タスク | `effort_md <= micro_task_threshold`. Bỏ ô `%`, chỉ Not started / Done (§7.9) |
| dependency | quan hệ phụ thuộc | 依存関係 | FS / SS / FF / SF |
| resource | nhân sự | 要員 | Tài nguyên **toàn cục**, dùng chung mọi dự án (§7.12) |
| assignment | phân công | 割り当て | Một task đúng một người (§7.8) |
| schedule | lịch (engine tính) | スケジュール | Chỉ engine ghi (N5) |
| progress | tiến độ (người nhập) | 進捗 | Chỉ người nhập, engine không bao giờ ghi (§7.11) |
| baseline | mốc chuẩn | ベースライン | Snapshot khi Close period (§7.13) |
| calendar | lịch làm việc | カレンダー | Hai loại tách bạch: năng lực và dự án (§5.1) |
| location | địa điểm | 拠点 | `VN` / `JP`. Quyết định lịch lễ quốc gia (§5.3) |
| team | nhóm | チーム | Đơn vị tổ chức theo dự án, **không tham gia tính lịch** (§5.1) |

## Trường và chỉ số

| English (code) | Tiếng Việt | 日本語 | Ghi chú |
|---|---|---|---|
| effort | khối lượng | 工数 | Đơn vị MD (man-day), bước nhảy 0.25 |
| MD (man-day) | ngày công | 人日 | Không quy đổi xuống giờ (§5.5) |
| allocation | tỷ lệ phân bổ | 稼働率 | 0.25 – 1.0 |
| capacity | năng lực | 稼働可能量 | 0 / 0.5 / 1.0 mỗi ngày |
| duration | thời lượng | 期間 | Ngày làm việc, không phải ngày lịch |
| float / slack | thời gian dự trữ | フロート / 余裕 | `total_float`, `free_float` |
| critical path | đường găng | クリティカルパス | Phân biệt `is_critical` (CPM) vs `is_resource_critical` |
| status date | ngày chốt số liệu | 基準日 | **Bắt buộc in trên đầu sheet báo cáo** (§11.3) |
| wbs_code | mã WBS | WBS番号 | Engine sinh, không sửa tay. Đổi mỗi lần renumber |
| uid | định danh task | タスクID | Ổn định vĩnh viễn. Mọi tham chiếu dùng uid, không dùng wbs_code |
| PIC | người phụ trách | 担当 | Không dùng "owner". Đúng một người mỗi task |
| remarks | ghi chú | 備考 | Cột J bản `summary`, lấy từ `progress.blocked_note` |

## Trạng thái — bắt buộc dịch đúng

| English (code) | Tiếng Việt | 日本語 |
|---|---|---|
| not_started | chưa bắt đầu | 未着手 |
| in_progress | đang làm | 進行中 |
| done | hoàn thành | 完了 |
| blocked | bị chặn | 保留 |
| cancelled | đã hủy | 中止 |

## Cách diễn đạt tiến độ — không được dùng lẫn

| English | 日本語 | Khi nào dùng |
|---|---|---|
| progress % (effort-based) | 進捗率（工数ベース） | Mặc định. Percent rollup theo trọng số MD (§7.7) |
| based on completed task count | 完了タスク数ベース | Khi phần lớn task lá là micro task (§7.9) |

Hai cách đo này ra số khác nhau. Báo cáo phải ghi rõ đang dùng cách nào — khách Nhật
sẽ hỏi, và trả lời sai một lần là mất tin cả bộ số liệu.

## Cột báo cáo Excel bản `summary` (§11.3)

| Cột | 日本語 | English |
|---|---|---|
| A | 大項目 | Major item |
| B | 中項目 | Sub item |
| C | 担当 | PIC |
| D | 状況 | Status |
| E | 進捗率（工数ベース） | Progress % (effort-based) |
| F | 計画開始 | Plan start |
| G | 計画完了 | Plan end |
| H | 実績開始 | Actual start |
| I | 実績完了 | Actual end |
| J | 備考 | Remarks |

## Lịch

| English (code) | Tiếng Việt | 日本語 | Ghi chú |
|---|---|---|---|
| holiday | ngày lễ | 祝日 | |
| substitute holiday | ngày nghỉ bù | 振替休日 | Lễ Nhật. Nạp từ nguồn chính thức, **không tự tính** (§5.4) |
| leave | nghỉ phép | 休暇 | `calendar_exception.kind='leave'` |
| overtime | làm bù | 休日出勤 | `capacity = 1` vào ngày vốn nghỉ |
| working day | ngày làm việc | 稼働日 | |

## Thuật ngữ thuật toán (giữ nguyên tiếng Anh)

| Viết tắt | Đầy đủ | Nghĩa |
|---|---|---|
| CPM | Critical Path Method | Pha A, giả định nguồn lực vô hạn (§7.2) |
| SGS | Schedule Generation Scheme | Pha B, xếp lịch theo cụm có ràng buộc nhân sự (§7.3) |
| RCPSP | Resource-Constrained Project Scheduling Problem | Bài toán gốc. NP-hard — không đuổi theo lời giải tối ưu (§1.3) |
| ES / EF | Early Start / Early Finish | Forward pass |
| LS / LF | Late Start / Late Finish | Backward pass |
| FS / SS / FF / SF | Finish-to-Start / Start-to-Start / Finish-to-Finish / Start-to-Finish | Bốn loại dependency (§6.1) |
| lag / lead | độ trễ / độ sớm | `lag_days` âm là lead |
