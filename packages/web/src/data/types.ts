/**
 * Kiểu của UI được SUY RA từ router, không chép tay.
 *
 * Trước đây file này khai báo lại `WbsRow` bằng tay, còn `App.tsx` ép kiểu kết quả tRPC
 * về nó. Bản chép tay lệch khỏi server lúc nào không hay: nó khai `issueCodes` trong khi
 * server chưa hề trả trường đó, `tsc` im lặng vì đã bị ép kiểu, và màn hình trắng ngay
 * lần chạy đầu với dữ liệu thật. Suy từ `AppRouter` biến mọi lệch pha thành lỗi biên dịch.
 */

import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@planix/server/router/index.js';

type Outputs = inferRouterOutputs<AppRouter>;
type Inputs = inferRouterInputs<AppRouter>;

export type WbsRow = Outputs['wbs']['tree'][number];
export type ProjectSummary = Outputs['projects']['list'][number];
export type IssueRow = Outputs['issues']['list'][number];
export type GanttRowData = Outputs['gantt']['get'][number];
export type ProgressBoardData = Outputs['progress']['board'];
export type TaskLinks = Outputs['wbs']['dependencies'];
export type TaskDetail = Outputs['wbs']['detail'];
export type AdminOverview = Outputs['admin']['overview'];
export type AdminResource = AdminOverview['resources'][number];
export type AdminCalendar = AdminOverview['calendars'][number];
export type AdminLocation = AdminOverview['locations'][number];
export type CalendarException = Outputs['admin']['exceptions'][number];
export type PoolLoad = Outputs['pool']['load'];
export type PoolRow = PoolLoad['rows'][number];
export type SaveResourceInput = Inputs['admin']['saveResource'];
export type TaskLabels = Pick<
  Inputs['wbs']['updateLabels'],
  'description' | 'category' | 'phase' | 'module' | 'externalRef'
>;
export type TaskLink = TaskLinks['predecessors'][number];
export type DependencyType = TaskLink['type'];
/** Phản hồi validate đi kèm mỗi lần sửa ràng buộc (§12.4). */
export type LinkIssue = Outputs['wbs']['setDependency']['issues'][number];
/** `null` = dự án chưa từng được validate, khác hẳn với "đã kiểm và sạch". */
export type ValidationRun = Outputs['issues']['lastRun'];
export type ValidationRunRow = Outputs['issues']['history'][number];
export type ImportCheck = Outputs['wbsImport']['dryRun'];
export type ImportDone = Extract<Outputs['wbsImport']['commit'], { ok: true }>;
export type BaselineRow = Outputs['period']['list'][number];
export type CloseResult = Outputs['period']['close'];
/**
 * Issue do validate sinh ra tại chỗ — KHÁC `IssueRow` đọc từ bảng.
 *
 * `IssueRow` có `detectedAt` vì nó là một dòng đã ghi xuống; thứ trả về từ `close` hay từ
 * export bị chặn thì chưa từng được ghi, nên không có mốc đó. Dùng lẫn hai kiểu là cách
 * chắc chắn để một hôm nào đó `detectedAt` hiện ra là `undefined` trên màn hình.
 */
export type BlockingIssue = CloseResult['issues'][number];
