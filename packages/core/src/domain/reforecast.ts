/**
 * Re-forecast theo tiến độ thực tế — SPEC.md §7.11.
 *
 * Chế độ dùng hàng tuần. Mốc chuẩn là `project.status_date`.
 *
 * **Engine KHÔNG BAO GIỜ ghi vào `progress`** (§7.11, N5). Hàm này chỉ đọc tiến độ
 * người nhập rồi trả về CHỈ DẪN lập lịch; ai ghi `progress` là màn S4, không phải engine.
 */

import type { DateOnly } from './date-only.js';
import type { ProgressStatus } from './validation-types.js';

export interface ReforecastTask {
  readonly uid: string;
  readonly effortMd: number;
  readonly status: ProgressStatus;
  readonly percent: number;
  /** Người nhập tay. NULL = suy từ percent. */
  readonly remainingMd: number | null;
  readonly actualStart: DateOnly | null;
  readonly actualEnd: DateOnly | null;
}

export type ReforecastMode =
  /** Đã xong: ngày thật cố định, không tính lại. */
  | 'fixed'
  /** Đang làm: giữ actual_start, tính phần còn lại từ status_date. */
  | 'partial'
  /** Chưa bắt đầu: lập lịch bình thường. */
  | 'fresh'
  /** Đã huỷ: loại khỏi lịch, dependency bắc cầu theo §6.5. */
  | 'excluded';

export interface ReforecastRow {
  readonly mode: ReforecastMode;
  readonly remainingMd: number;
  readonly fixedStart: DateOnly | null;
  readonly fixedEnd: DateOnly | null;
  /** Cận dưới cho phần còn lại. NULL khi không cần lập lịch nữa. */
  readonly earliestStart: DateOnly | null;
}

export interface ReforecastIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly taskUid: string;
}

export interface ReforecastResult {
  readonly rows: ReadonlyMap<string, ReforecastRow>;
  readonly issues: readonly ReforecastIssue[];
  get(uid: string): ReforecastRow | undefined;
}

export function reforecast(
  tasks: readonly ReforecastTask[],
  statusDate: DateOnly,
): ReforecastResult {
  const rows = new Map<string, ReforecastRow>();
  const issues: ReforecastIssue[] = [];

  // Duyệt theo uid đã sắp để thứ tự issue tái lập được (N2).
  const ordered = [...tasks].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

  for (const t of ordered) {
    /**
     * §7.11: ưu tiên `remaining_md` nhập tay hơn suy từ percent.
     *
     * Task 80% thường không còn đúng 20% việc — người làm biết rõ hơn công thức. Dùng
     * `!== null` chứ không dùng `||`: `remaining_md = 0` là thông tin thật ("còn 0 việc"),
     * không phải "chưa nhập".
     */
    const derived = t.effortMd * (1 - t.percent / 100);
    const remaining = t.remainingMd !== null ? t.remainingMd : derived;

    if (t.percent > 0 && t.status === 'not_started') {
      issues.push({
        code: 'J10',
        severity: 'Major',
        message: `Task ${t.uid} has percent ${t.percent} but status not_started.`,
        taskUid: t.uid,
      });
    }

    switch (t.status) {
      case 'done': {
        if (t.actualStart === null || t.actualEnd === null) {
          issues.push({
            code: 'C11',
            severity: 'Critical',
            message: `Task ${t.uid} is done but actual_start or actual_end is missing.`,
            taskUid: t.uid,
          });
        }
        if (t.percent < 100) {
          issues.push({
            code: 'J12',
            severity: 'Major',
            message: `Task ${t.uid} is done but percent is ${t.percent}.`,
            taskUid: t.uid,
          });
        }
        rows.set(t.uid, {
          mode: 'fixed',
          remainingMd: 0,
          fixedStart: t.actualStart,
          fixedEnd: t.actualEnd,
          earliestStart: null,
        });
        break;
      }

      case 'in_progress':
      case 'blocked': {
        if (t.status === 'blocked') {
          issues.push({
            code: 'J13',
            severity: 'Major',
            message: `Task ${t.uid} is blocked; remaining work is forecast from status_date.`,
            taskUid: t.uid,
          });
        }
        if (t.actualStart === null) {
          issues.push({
            code: 'J09',
            severity: 'Major',
            message: `Task ${t.uid} is ${t.status} but has no actual_start.`,
            taskUid: t.uid,
          });
        }
        rows.set(t.uid, {
          mode: 'partial',
          remainingMd: remaining,
          fixedStart: t.actualStart,
          fixedEnd: null,
          earliestStart: statusDate,
        });
        break;
      }

      case 'cancelled': {
        rows.set(t.uid, {
          mode: 'excluded',
          remainingMd: 0,
          fixedStart: null,
          fixedEnd: null,
          earliestStart: null,
        });
        break;
      }

      case 'not_started': {
        rows.set(t.uid, {
          mode: 'fresh',
          remainingMd: remaining,
          fixedStart: null,
          fixedEnd: null,
          earliestStart: statusDate,
        });
        break;
      }
    }
  }

  return { rows, issues, get: (uid) => rows.get(uid) };
}
