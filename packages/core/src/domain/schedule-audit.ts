/**
 * Những rule §8 chỉ trả lời được SAU khi đã xếp lịch — SPEC.md §8.2, §8.3.
 *
 * Vì sao không nằm trong `validator.ts`: chúng là tính chất của **kết quả phân bổ**, không
 * phải của dữ liệu đầu vào. `validate()` nhận một ảnh chụp task/dependency/progress và
 * phải chạy được ngay lúc import, khi chưa có lịch lẫn `assignment`. Nhét chúng vào đó sẽ
 * buộc mọi lời gọi validate phải mang theo dữ liệu mà phần lớn trường hợp không có.
 *
 * Chỗ đúng là pipeline, nơi `J01` và `J14` đã nằm — xem `sgs.ts`.
 *
 * Hàm thuần (CLAUDE.md §3): nhận dữ liệu, trả issue. Không đọc DB, không đọc đồng hồ.
 */

import type { DateOnly } from './date-only.js';
import type { DepIssue } from './dependency.js';

/** Đủ để nhận ra một task trong thông điệp, không cần cả `TaskRow`. */
export interface AuditTask {
  readonly uid: string;
  readonly wbsCode: string;
  readonly kind: 'summary' | 'work' | 'milestone';
  /** Nơi làm việc, quyết định lịch nghỉ nào áp cho task này (§5.4). */
  readonly locationId: string | null;
}

export interface AuditAssignment {
  readonly taskUid: string;
  readonly resourceId: string;
  readonly allocation: number;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
}

/** Phần lịch mà các rule dưới đây cần. */
export interface AuditSchedule {
  readonly taskUid: string;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
}

/** §8.3 `N06` — dưới mức này, và kéo dài, là dấu hiệu bị chia mỏng. */
const THIN_ALLOCATION = 0.5;
const THIN_DAYS_LIMIT = 10;

/** §8.2 `J07` — pha B dài hơn pha A quá ngần này thì là thiếu người nghiêm trọng. */
const PHASE_SKEW_LIMIT = 0.2;

function major(code: string, message: string, taskUid?: string): DepIssue {
  return {
    code,
    severity: 'Major',
    message,
    ...(taskUid === undefined ? {} : { detail: { taskUid } }),
  };
}

function minor(code: string, message: string, taskUid?: string): DepIssue {
  return {
    code,
    severity: 'Minor',
    message,
    ...(taskUid === undefined ? {} : { detail: { taskUid } }),
  };
}

/**
 * `J07` — chênh lệch giữa pha A và pha B vượt 20%.
 *
 * §7.2 nói thẳng ý nghĩa của con số này: *"chênh lệch giữa pha A và pha B chính là chi phí
 * do thiếu người. Đây là con số cần khi đàm phán thêm resource."* Nên rule không đo "lịch
 * có xấu không" mà đo **đúng một thứ**: bao nhiêu phần trăm thời gian bị kéo dài ra chỉ vì
 * không đủ người.
 *
 * Đo bằng NGÀY LÀM VIỆC, không phải ngày lịch: một dự án kết thúc muộn hơn ba ngày vì rơi
 * vào cuối tuần thì không phải chi phí thiếu người.
 *
 * Pha A rỗng hoặc dài 0 ngày thì không có mẫu số — im lặng.
 */
export function checkPhaseSkew(params: {
  readonly phaseAEnd: DateOnly | null;
  readonly phaseBEnd: DateOnly | null;
  readonly projectStart: DateOnly;
  readonly workingDaysBetween: (a: DateOnly, b: DateOnly) => number;
}): DepIssue[] {
  const { phaseAEnd, phaseBEnd, projectStart, workingDaysBetween } = params;
  if (phaseAEnd === null || phaseBEnd === null) return [];

  const durationA = workingDaysBetween(projectStart, phaseAEnd);
  if (durationA <= 0) return [];
  const durationB = workingDaysBetween(projectStart, phaseBEnd);

  const skew = (durationB - durationA) / durationA;
  if (skew <= PHASE_SKEW_LIMIT) return [];

  return [
    major(
      'J07',
      `Resource limits stretch the schedule ${String(Math.round(skew * 100))}% beyond the ideal plan ` +
        `(${String(durationA)} → ${String(durationB)} working days).`,
    ),
  ];
}

/**
 * `J08` — milestone rơi vào ngày nghỉ.
 *
 * §5.4: *"engine **không tự dời**. Ghi issue `J08` kèm ngày làm việc gần nhất."* Cố ý không
 * tự dời: một mốc bàn giao rơi vào ngày lễ là chuyện phải NÓI với khách, không phải chuyện
 * lặng lẽ đẩy sang hôm sau rồi coi như xong.
 *
 * Vì vậy thông điệp phải kèm ngày thay thế — thiếu nó thì PM lại phải đi tra lịch.
 */
export function checkMilestonesOnHolidays(params: {
  readonly tasks: readonly AuditTask[];
  readonly schedule: readonly AuditSchedule[];
  readonly isWorkingAtLocation: (locationId: string | null, date: DateOnly) => boolean;
  readonly nextWorkingDayAtLocation: (locationId: string | null, date: DateOnly) => DateOnly;
}): DepIssue[] {
  const { tasks, schedule, isWorkingAtLocation, nextWorkingDayAtLocation } = params;
  const endByUid = new Map(schedule.map((s) => [s.taskUid, s.endDate]));
  const issues: DepIssue[] = [];

  for (const t of tasks) {
    if (t.kind !== 'milestone') continue;
    const end = endByUid.get(t.uid);
    if (end === undefined) continue;
    if (isWorkingAtLocation(t.locationId, end)) continue;

    const nearest = nextWorkingDayAtLocation(t.locationId, end);
    issues.push(
      major(
        'J08',
        `Milestone ${t.wbsCode} falls on ${end}, a non-working day. Nearest is ${nearest}.`,
        t.uid,
      ),
    );
  }
  return issues;
}

/**
 * `N06` — task bị chia mỏng dưới 0.5 allocation liên tục trên 10 ngày.
 *
 * §7.5 cho phép hạ allocation xuống tới `min_allocation` để nhét việc vào chỗ trống. Hữu
 * ích, nhưng quá tay thì một task 2 MD kéo lê hàng tháng ở mức 0.25 — trên giấy vẫn "đang
 * chạy", thực tế thì không ai thực sự làm nó.
 *
 * Mỗi `assignment` là một khoảng LIÊN TỤC, nên chỉ cần đo độ dài của nó; không phải ghép
 * các khoảng rời lại. Đo bằng ngày làm việc — mười ngày làm việc mới là hai tuần.
 */
export function checkThinAllocations(params: {
  readonly tasks: readonly AuditTask[];
  readonly assignments: readonly AuditAssignment[];
  readonly workingDaysBetween: (a: DateOnly, b: DateOnly) => number;
}): DepIssue[] {
  const { tasks, assignments, workingDaysBetween } = params;
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const issues: DepIssue[] = [];

  for (const a of assignments) {
    if (a.allocation >= THIN_ALLOCATION) continue;
    const days = workingDaysBetween(a.fromDate, a.toDate);
    if (days <= THIN_DAYS_LIMIT) continue;

    const task = byUid.get(a.taskUid);
    if (task === undefined) continue;
    issues.push(
      minor(
        'N06',
        `Task ${task.wbsCode} runs at ${String(a.allocation)} allocation for ${String(days)} working days.`,
        a.taskUid,
      ),
    );
  }
  return issues;
}
