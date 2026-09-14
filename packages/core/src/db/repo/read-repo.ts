/**
 * Lớp tương thích — nội dung đã tách ra bốn file.
 *
 * File này từng dài **1362 dòng** và trộn sáu nhóm không liên quan: cây WBS, tiến độ,
 * Gantt, ảnh chụp lịch, báo cáo Excel, EVM. Nó cũng chứa cả đường ĐỌC lẫn đường GHI, nên
 * cái tên `read-repo` đã sai từ lâu.
 *
 * | Nhóm | Nay ở |
 * |---|---|
 * | Cây WBS, sửa task, move/sequencing, CRUD, dependency | `wbs-repo.ts` |
 * | Tiến độ, bảng nhập của lead | `progress-repo.ts` |
 * | Gantt, ảnh chụp lịch | `gantt-repo.ts` |
 * | Báo cáo Excel, EVM | `report-repo.ts` |
 *
 * ## Vì sao giữ lại file này thay vì sửa hết nơi gọi
 *
 * Có 19 chỗ import, phần lớn dùng `import * as read from './read-repo.js'`. Đổi hết sang
 * bốn namespace là một diff lớn trộn lẫn với chính việc tách file — và khi có gì hỏng thì
 * không tách được nguyên nhân ra khỏi nhau.
 *
 * Tách file trước, dời nơi gọi sau, mỗi việc một commit (CLAUDE.md §7).
 *
 * **Code mới nên import thẳng file cụ thể**, không qua file này.
 */

export * from './wbs-repo.js';
export * from './progress-repo.js';
export * from './gantt-repo.js';
export * from './report-repo.js';
