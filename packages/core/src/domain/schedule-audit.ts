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

import { addDays, compareDateOnly, type DateOnly } from './date-only.js';
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

/** §8.2 `J06` — dưới mức này là người đang rảnh. */
const LOW_UTILISATION = 0.3;

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

/**
 * `J06` — resource có tỷ lệ sử dụng dưới 30%.
 *
 * Ba quyết định, PM chốt ngày 2026-09-13 (xem
 * `docs/decisions/2026-09-13-j06-pool-chung.md`):
 *
 * 1. **Đo trên pool CHUNG.** §7.12 cho hai dự án dùng chung người, nên chỉ đếm assignment
 *    của dự án đang xét sẽ biến một người bận 100% ở nơi khác thành "rảnh 0%" — cảnh báo
 *    sai trên mọi dự án, ngay từ dự án thứ hai.
 * 2. **Chỉ báo cho người CÓ làm dự án này.** Đo toàn cục rồi báo ở mọi dự án thì cùng một
 *    phát hiện lặp lại khắp nơi.
 * 3. **Cửa sổ tính từ `status_date`, không phải từ đầu dự án.** Đo cả span thì người tham
 *    gia ở giai đoạn cuối luôn hiện ra là rảnh — dù họ chưa tới lượt. Câu hỏi PM đặt là
 *    "ai đang rảnh", ở thì hiện tại.
 *
 * Mẫu số là năng lực THẬT của người đó trong cửa sổ — lịch A, đã trừ lễ và nghỉ phép cá
 * nhân. Lấy số ngày lịch làm mẫu số sẽ biến người nghỉ phép dài thành người lười.
 */
export function checkResourceUtilisation(params: {
  /** Người có ít nhất một assignment trong dự án đang xét. */
  readonly resourceIds: readonly string[];
  /** Assignment của MỌI dự án — đó là cả điểm của rule này. */
  readonly assignments: readonly AuditAssignment[];
  readonly windowStart: DateOnly;
  readonly windowEnd: DateOnly;
  /** Lịch A: năng lực của chính người đó trong một ngày (0 | 0.5 | 1). */
  readonly capacityOn: (resourceId: string, date: DateOnly) => number;
}): DepIssue[] {
  const { resourceIds, assignments, windowStart, windowEnd, capacityOn } = params;
  if (compareDateOnly(windowStart, windowEnd) > 0) return [];

  const byResource = new Map<string, AuditAssignment[]>();
  for (const a of assignments) {
    const list = byResource.get(a.resourceId);
    if (list === undefined) byResource.set(a.resourceId, [a]);
    else list.push(a);
  }

  const issues: DepIssue[] = [];
  // Sắp theo id: thứ tự issue không được phụ thuộc thứ tự mảng vào (N2).
  for (const resourceId of [...resourceIds].sort()) {
    let available = 0;
    let allocated = 0;

    for (let day = windowStart; compareDateOnly(day, windowEnd) <= 0; day = addDays(day, 1)) {
      const capacity = capacityOn(resourceId, day);
      if (capacity <= 0) continue;
      available += capacity;

      for (const a of byResource.get(resourceId) ?? []) {
        if (compareDateOnly(day, a.fromDate) < 0 || compareDateOnly(day, a.toDate) > 0) continue;
        // Nhân với capacity: nửa ngày làm ở mức 0.5 allocation là 0.25 người-ngày, không
        // phải 0.5. Mẫu số cũng tính theo capacity nên hai vế cùng đơn vị.
        allocated += a.allocation * capacity;
      }
    }

    // Không có ngày làm nào trong cửa sổ (nghỉ phép dài, hoặc mới vào sau) — không có mẫu
    // số thì không kết luận được gì.
    if (available <= 0) continue;

    const utilisation = allocated / available;
    if (utilisation >= LOW_UTILISATION) continue;

    issues.push({
      code: 'J06',
      severity: 'Major',
      message:
        `Resource ${resourceId} is ${String(Math.round(utilisation * 100))}% utilised ` +
        `between ${windowStart} and ${windowEnd}.`,
      detail: { resourceId, utilisation: Math.round(utilisation * 100) / 100 },
    });
  }
  return issues;
}
