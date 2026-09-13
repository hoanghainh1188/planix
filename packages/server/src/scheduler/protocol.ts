/**
 * Giao thức giữa tiến trình chính và worker lập lịch — SPEC.md §7.14, §3.1.
 *
 * Tách riêng khỏi cả hai phía để hai bên không import lẫn nhau: worker chạy trong ngữ
 * cảnh khác, và kéo theo cả cây import của server vào đó là cách chắc chắn để một ngày
 * nào đó vô tình khởi tạo hai kết nối DB.
 */

export interface SchedulerRequest {
  /** Đường dẫn file DB. Worker mở kết nối RIÊNG — `:memory:` không dùng được. */
  readonly dbPath: string;
  /** Dự án cần xếp. Bỏ qua khi `scope` là 'all'. */
  readonly projectId: string;
  /** 'project' = chỉ dự án này (§7.12 "Recalculate this project"); 'all' = mọi dự án. */
  readonly scope: 'project' | 'all';
  readonly runId: string;
  readonly now: string;
  readonly windowDays?: number;
}

export interface SchedulerSuccess {
  readonly ok: true;
  readonly scheduledCount: number;
  readonly assignedCount: number;
  readonly writeLockMs: number;
  readonly projectEnd: string | null;
  readonly issueCount: number;
  /** Khi chạy 'all': thứ tự dự án đã xếp. */
  readonly order?: readonly string[];
}

export interface SchedulerFailure {
  readonly ok: false;
  readonly name: string;
  readonly message: string;
  /** Mã Critical khi bị validate chặn — để UI hiện đúng vấn đề. */
  readonly criticalCodes?: readonly string[];
}

export type SchedulerResponse = SchedulerSuccess | SchedulerFailure;
