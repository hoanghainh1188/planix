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
import { spreadOf } from './resource-load.js';
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

/**
 * Thêm khối lượng thật, cho rule cần ĐO TẢI.
 *
 * Hai rule dùng hai thứ khác nhau, và đó không phải chuyện tuỳ tiện:
 *
 *   - `N06` hỏi *"người này bị chia mỏng tới mức nào"* — tức hỏi về chính con số
 *     `allocation`. Dùng `AuditAssignment` là đúng.
 *   - `J06` hỏi *"người này được dùng bao nhiêu phần trăm năng lực"* — tức hỏi về KHỐI
 *     LƯỢNG. `allocation` không trả lời được câu đó, vì `from_date`/`to_date` là bao
 *     ngoài chứ không phải danh sách ngày làm.
 */
export interface UtilisationAssignment extends AuditAssignment {
  readonly effortMd: number;
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

/**
 * §8.2 `J06` — dưới mức này là người đang rảnh. PM nâng từ 0.3 lên 0.5 ngày 2026-09-14.
 *
 * 0.3 được đặt khi phép đo còn phóng đại tỷ lệ sử dụng 6–32 điểm phần trăm (xem
 * `docs/decisions/2026-09-14-tai-nhan-su-tinh-sai.md`), tức nó được hiệu chỉnh theo một
 * thước đo sai. Với thước đo đúng, `data/dev.db` cho thấy cả hai đội nằm trong khoảng
 * 41–67% — không ai chạm 30%, nên rule im lặng trong khi dự án UTG có tới một nửa năng
 * lực chưa dùng tới.
 */
const LOW_UTILISATION = 0.5;

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
  readonly assignments: readonly UtilisationAssignment[];
  readonly windowStart: DateOnly;
  readonly windowEnd: DateOnly;
  /** Lịch A: năng lực của chính người đó trong một ngày (0 | 0.5 | 1). */
  readonly capacityOn: (resourceId: string, date: DateOnly) => number;
}): DepIssue[] {
  const { resourceIds, assignments, windowStart, windowEnd, capacityOn } = params;
  if (compareDateOnly(windowStart, windowEnd) > 0) return [];

  const byResource = new Map<string, UtilisationAssignment[]>();
  for (const a of assignments) {
    const list = byResource.get(a.resourceId);
    if (list === undefined) byResource.set(a.resourceId, [a]);
    else list.push(a);
  }

  // Tính trước cho MỌI người, rồi mới quyết định phát ra dạng nào.
  //
  // Sắp theo id: thứ tự không được phụ thuộc thứ tự mảng vào (N2).
  const measured: Array<{ resourceId: string; utilisation: number }> = [];
  for (const resourceId of [...resourceIds].sort()) {
    let available = 0;
    let allocated = 0;

    // Rải `effort_md` theo năng lực từng ngày, KHÔNG nhân `allocation` với mọi ngày trong
    // khoảng. `assignment.from_date`/`to_date` là bao ngoài; SGS chỉ giữ chỗ trên một số
    // ngày bên trong và DB không lưu danh sách ngày. Đo trên `data/dev.db`: cách cũ phóng
    // đại tỷ lệ sử dụng 6–32 điểm phần trăm — R-03 đọc 83% trong khi thật là 51%.
    //
    // Dùng chung `spreadOf` với `resource-load.ts` để hai chỗ không thể lệch nhau: cùng
    // một câu hỏi mà hai con số khác nhau thì không ai biết tin cái nào.
    const spread = (byResource.get(resourceId) ?? []).map((a) => ({
      from: a.fromDate,
      to: a.toDate,
      load: spreadOf(a, capacityOn),
    }));

    for (let day = windowStart; compareDateOnly(day, windowEnd) <= 0; day = addDays(day, 1)) {
      const capacity = capacityOn(resourceId, day);
      if (capacity <= 0) continue;
      available += capacity;

      for (const a of spread) {
        if (compareDateOnly(day, a.from) < 0 || compareDateOnly(day, a.to) > 0) continue;
        allocated += a.load(day);
      }
    }

    // Không có ngày làm nào trong cửa sổ (nghỉ phép dài, hoặc mới vào sau) — không có mẫu
    // số thì không kết luận được gì.
    if (available <= 0) continue;
    measured.push({ resourceId, utilisation: allocated / available });
  }

  const idle = measured.filter((m) => m.utilisation < LOW_UTILISATION);
  if (idle.length === 0) return [];

  const pct = (u: number): number => Math.round(u * 100);

  /**
   * CẢ đội cùng dưới ngưỡng ⇒ một issue mức dự án, không phải mỗi người một issue.
   *
   * PM chốt 2026-09-14, cùng cách đã chọn cho `J14`. Lý do đo được: engine san tải đều nên
   * trên `data/dev.db` mười người của UTG nằm gọn trong khoảng 41–50%. Mọi ngưỡng vì thế
   * hoặc im lặng, hoặc báo toàn đội — và "toàn đội" là một phát hiện MỨC DỰ ÁN ("dự án này
   * dư một nửa năng lực"), không phải mười phát hiện giống hệt nhau về mười cá nhân.
   *
   * Chỉ một người trong danh sách thì gộp vô nghĩa, nên vẫn phát dạng cá nhân.
   */
  if (idle.length === measured.length && measured.length > 1) {
    const lowest = pct(Math.min(...idle.map((m) => m.utilisation)));
    const highest = pct(Math.max(...idle.map((m) => m.utilisation)));
    return [
      {
        code: 'J06',
        severity: 'Major',
        message:
          `All ${String(idle.length)} people on this project are under ` +
          `${String(pct(LOW_UTILISATION))}% utilised between ${windowStart} and ${windowEnd} ` +
          `(${String(lowest)}%–${String(highest)}%).`,
        detail: {
          scope: 'project',
          resourceCount: idle.length,
          resourceIds: idle.map((m) => m.resourceId),
          lowestUtilisation: Math.round(Math.min(...idle.map((m) => m.utilisation)) * 100) / 100,
          highestUtilisation: Math.round(Math.max(...idle.map((m) => m.utilisation)) * 100) / 100,
        },
      },
    ];
  }

  return idle.map((m) => ({
    code: 'J06',
    severity: 'Major' as const,
    message:
      `Resource ${m.resourceId} is ${String(pct(m.utilisation))}% utilised ` +
      `between ${windowStart} and ${windowEnd}.`,
    detail: { resourceId: m.resourceId, utilisation: Math.round(m.utilisation * 100) / 100 },
  }));
}
