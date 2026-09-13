/**
 * Kiểu của UI được SUY RA từ router, không chép tay.
 *
 * Trước đây file này khai báo lại `WbsRow` bằng tay, còn `App.tsx` ép kiểu kết quả tRPC
 * về nó. Bản chép tay lệch khỏi server lúc nào không hay: nó khai `issueCodes` trong khi
 * server chưa hề trả trường đó, `tsc` im lặng vì đã bị ép kiểu, và màn hình trắng ngay
 * lần chạy đầu với dữ liệu thật. Suy từ `AppRouter` biến mọi lệch pha thành lỗi biên dịch.
 */

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@planix/server/router/index.js';

type Outputs = inferRouterOutputs<AppRouter>;

export type WbsRow = Outputs['wbs']['tree'][number];
export type ProjectSummary = Outputs['projects']['list'][number];
export type IssueRow = Outputs['issues']['list'][number];
export type GanttRowData = Outputs['gantt']['get'][number];
export type ProgressBoardData = Outputs['progress']['board'];
export type TaskLinks = Outputs['wbs']['dependencies'];
export type TaskLink = TaskLinks['predecessors'][number];
export type DependencyType = TaskLink['type'];
/** Phản hồi validate đi kèm mỗi lần sửa ràng buộc (§12.4). */
export type LinkIssue = Outputs['wbs']['setDependency']['issues'][number];
/** `null` = dự án chưa từng được validate, khác hẳn với "đã kiểm và sạch". */
export type ValidationRun = Outputs['issues']['lastRun'];
