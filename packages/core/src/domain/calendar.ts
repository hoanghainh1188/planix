/**
 * Calendar Engine — SPEC.md §5.
 *
 * §5.1 tách bạch HAI loại lịch, và đây là chỗ dễ nhầm nhất của cả engine:
 *
 *   Lịch A — năng lực : "ngày X, người Y làm được bao nhiêu?"  Toàn cục, chuỗi kế
 *                        thừa location → cá nhân. Dùng cho SGS và capacity.
 *   Lịch B — dự án    : "cộng 2 ngày làm việc vào ngày X ra ngày nào?"  Theo dự án,
 *                        một tầng. Dùng cho lag dependency và milestone.
 *
 * Team KHÔNG nằm trong chuỗi lịch nào (§5.1).
 *
 * Hàm thuần trên một ảnh chụp dữ liệu: không đọc DB (CLAUDE.md §3), không đọc đồng hồ (N2).
 */

import { addDays, dayOfWeekMon0, toEpochDay, type DateOnly } from './date-only.js';

export type CalendarScope = 'project' | 'location' | 'resource';
export type ExceptionKind = 'holiday' | 'leave' | 'overtime' | 'other';

export interface CalendarDef {
  readonly id: string;
  readonly scope: CalendarScope;
  readonly parentId: string | null;
  /** 7 ký tự Mon..Sun, mỗi ký tự 0 | 5 (nửa ngày) | 1. NULL = kế thừa hoàn toàn từ cha. */
  readonly weekPattern: string | null;
}

export interface CalendarExceptionDef {
  readonly calendarId: string;
  readonly dateFrom: DateOnly;
  readonly dateTo: DateOnly;
  readonly capacity: number;
  readonly kind: ExceptionKind;
}

export interface LocationDef {
  readonly id: string;
  readonly calendarId: string;
}

export interface ResourceDef {
  readonly id: string;
  readonly locationId: string;
  /** NULL = dùng thẳng lịch của location (§4.2). */
  readonly calendarId: string | null;
  readonly dailyCapacity: number;
  readonly availableFrom: DateOnly | null;
  readonly availableTo: DateOnly | null;
}

export interface CalendarSnapshot {
  readonly calendars: readonly CalendarDef[];
  readonly exceptions: readonly CalendarExceptionDef[];
  readonly locations: readonly LocationDef[];
  readonly resources: readonly ResourceDef[];
}

export interface CalendarEngine {
  // Lịch A
  capacityOn(resourceId: string, date: DateOnly): number;
  workSlots(resourceId: string, from: DateOnly, limit: number): DateOnly[];

  // Lịch B
  isWorking(calendarId: string, date: DateOnly): boolean;
  /**
   * Capacity của một ngày trên lịch B (0 | 0.5 | 1).
   *
   * §5.6 chỉ liệt kê `isWorking` (boolean), nhưng `week_pattern` của §4.2 cho phép
   * nửa ngày và §7.2 tính duration theo bước 0.5. CPM cần con số, không chỉ có/không.
   * `isWorking` chính là `capacityOfCalendar > 0`.
   */
  capacityOfCalendar(calendarId: string, date: DateOnly): number;
  addWorkingDays(calendarId: string, from: DateOnly, days: number): DateOnly;
  workingDaysBetween(calendarId: string, a: DateOnly, b: DateOnly): number;
  nextWorkingDay(calendarId: string, from: DateOnly): DateOnly;

  // Location
  isWorkingAtLocation(locationId: string, date: DateOnly): boolean;
  nextWorkingDayAtLocation(locationId: string, from: DateOnly): DateOnly;
}

/** Đọc một ký tự của `week_pattern`: '0' nghỉ, '5' nửa ngày, còn lại là 1. */
function patternValue(pattern: string, dowMon0: number): number {
  const ch = pattern[dowMon0];
  if (ch === '0') return 0;
  if (ch === '5') return 0.5;
  return 1;
}

/**
 * Chặn trên số ngày duyệt khi đi tìm ngày làm việc.
 *
 * Lịch có `week_pattern = '0000000'` cộng đủ exception nghỉ sẽ khiến vòng lặp chạy
 * mãi. Thà ném lỗi đọc được còn hơn treo tiến trình — và với §1.5 (400 ngày làm việc)
 * thì 4000 ngày lịch là thừa rộng cho mọi trường hợp thật.
 */
const MAX_SCAN_DAYS = 4000;

export function createCalendarEngine(snapshot: CalendarSnapshot): CalendarEngine {
  const calendarById = new Map(snapshot.calendars.map((c) => [c.id, c]));
  const locationById = new Map(snapshot.locations.map((l) => [l.id, l]));
  const resourceById = new Map(snapshot.resources.map((r) => [r.id, r]));

  const exceptionsByCalendar = new Map<string, CalendarExceptionDef[]>();
  for (const ex of snapshot.exceptions) {
    const list = exceptionsByCalendar.get(ex.calendarId);
    if (list === undefined) exceptionsByCalendar.set(ex.calendarId, [ex]);
    else list.push(ex);
  }

  /**
   * Cache mẫu tuần đã phân giải theo chuỗi kế thừa. §5.6 bắt buộc cache theo
   * (calendarId, year); mẫu tuần không phụ thuộc năm nên chỉ cần theo calendarId.
   */
  const resolvedPattern = new Map<string, string>();

  function requireCalendar(calendarId: string): CalendarDef {
    const cal = calendarById.get(calendarId);
    if (cal === undefined) throw new Error(`Unknown calendar: ${calendarId}`);
    return cal;
  }

  /** Mẫu tuần hiệu lực: đi ngược chuỗi cha tới khi gặp mẫu không NULL (§5.2 bước 1). */
  function patternOf(calendarId: string): string {
    const cached = resolvedPattern.get(calendarId);
    if (cached !== undefined) return cached;

    const seen = new Set<string>();
    let current: CalendarDef | undefined = requireCalendar(calendarId);
    while (current !== undefined) {
      if (seen.has(current.id)) {
        throw new Error(`Cycle in calendar parent chain at ${current.id}`);
      }
      seen.add(current.id);

      if (current.weekPattern !== null) {
        resolvedPattern.set(calendarId, current.weekPattern);
        return current.weekPattern;
      }
      current = current.parentId === null ? undefined : requireCalendar(current.parentId);
    }
    throw new Error(`Calendar ${calendarId} has no week_pattern anywhere in its parent chain`);
  }

  /**
   * Cache theo (calendarId, year) như §5.6 yêu cầu.
   *
   * Không cache thì 6.000 task x 30 người x 400 ngày là không chạy nổi (§5.6). Mỗi ô
   * là capacity của một ngày trong năm; dựng một lần cho cả năm rồi tra bằng chỉ số.
   */
  const yearCache = new Map<string, Float64Array>();

  function yearKey(calendarId: string, year: number): string {
    return `${calendarId}#${year}`;
  }

  function capacityFromCalendar(calendarId: string, date: DateOnly): number {
    const year = Number(date.slice(0, 4));
    const key = yearKey(calendarId, year);

    let row = yearCache.get(key);
    if (row === undefined) {
      const jan1 = `${String(year).padStart(4, '0')}-01-01` as DateOnly;
      const start = toEpochDay(jan1);
      const dec31 = `${String(year).padStart(4, '0')}-12-31` as DateOnly;
      const length = toEpochDay(dec31) - start + 1;

      const pattern = patternOf(calendarId);
      row = new Float64Array(length);
      for (let i = 0; i < length; i++) {
        row[i] = patternValue(pattern, dayOfWeekMon0(addDays(jan1, i)));
      }

      // Exception ghi đè mẫu tuần. Áp theo thứ tự mảng đầu vào; nhiều exception chồng
      // nhau trên cùng lịch thì cái sau thắng — giữ nguyên thứ tự DB trả về (ORDER BY id).
      for (const ex of exceptionsByCalendar.get(calendarId) ?? []) {
        const from = Math.max(start, toEpochDay(ex.dateFrom));
        const to = Math.min(start + length - 1, toEpochDay(ex.dateTo));
        for (let e = from; e <= to; e++) row[e - start] = ex.capacity;
      }

      yearCache.set(key, row);
    }

    const idx = toEpochDay(date) - toEpochDay(`${String(year).padStart(4, '0')}-01-01` as DateOnly);
    return row[idx] ?? 0;
  }

  function personalCalendarOf(resourceId: string): {
    calendarId: string;
    locationCalendarId: string;
  } {
    const res = resourceById.get(resourceId);
    if (res === undefined) throw new Error(`Unknown resource: ${resourceId}`);
    const loc = locationById.get(res.locationId);
    if (loc === undefined)
      throw new Error(`Unknown location ${res.locationId} on resource ${resourceId}`);
    return {
      calendarId: res.calendarId ?? loc.calendarId,
      locationCalendarId: loc.calendarId,
    };
  }

  function capacityOn(resourceId: string, date: DateOnly): number {
    const res = resourceById.get(resourceId);
    if (res === undefined) throw new Error(`Unknown resource: ${resourceId}`);

    // §5.2 bước 4 — ngoài khoảng khả dụng là 0, thắng mọi thứ khác kể cả làm bù.
    if (res.availableFrom !== null && date < res.availableFrom) return 0;
    if (res.availableTo !== null && date > res.availableTo) return 0;

    const { calendarId, locationCalendarId } = personalCalendarOf(resourceId);

    // §5.2 bước 2 — áp location trước, cá nhân sau; cá nhân ghi đè location.
    let capacity = capacityFromCalendar(locationCalendarId, date);
    if (calendarId !== locationCalendarId) {
      const personalExceptions = exceptionsByCalendar.get(calendarId) ?? [];
      const hasPersonalOverride = personalExceptions.some(
        (ex) => ex.dateFrom <= date && date <= ex.dateTo,
      );
      // Lịch cá nhân quyết định mẫu tuần; exception cá nhân chỉ ghi đè khi thật sự có.
      capacity = hasPersonalOverride
        ? capacityFromCalendar(calendarId, date)
        : Math.min(capacity, capacityFromCalendar(calendarId, date));
    }

    // §5.2 bước 3.
    return capacity * res.dailyCapacity;
  }

  function workSlots(resourceId: string, from: DateOnly, limit: number): DateOnly[] {
    const out: DateOnly[] = [];
    let cursor = from;
    for (let i = 0; i < MAX_SCAN_DAYS && out.length < limit; i++) {
      if (capacityOn(resourceId, cursor) > 0) out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  function isWorking(calendarId: string, date: DateOnly): boolean {
    return capacityFromCalendar(calendarId, date) > 0;
  }

  function nextWorkingDay(calendarId: string, from: DateOnly): DateOnly {
    let cursor = from;
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      if (isWorking(calendarId, cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    throw new Error(
      `No working day found within ${MAX_SCAN_DAYS} days after ${from} on ${calendarId}`,
    );
  }

  /**
   * Cộng/trừ ngày làm việc, đếm theo capacity nên hỗ trợ nửa ngày (§5.5).
   *
   * `days` âm là lead (§6.1): đi ngược. `days = 0` giữ nguyên ngày, KHÔNG nhảy tới
   * ngày làm gần nhất — việc nhảy là của `nextWorkingDay`, trộn hai thứ vào một hàm
   * làm lag 0 lặng lẽ dời lịch.
   */
  function addWorkingDays(calendarId: string, from: DateOnly, days: number): DateOnly {
    if (days === 0) return from;

    const step = days > 0 ? 1 : -1;
    const target = Math.abs(days);
    let accumulated = 0;
    let cursor = from;

    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      cursor = addDays(cursor, step);
      accumulated += capacityFromCalendar(calendarId, cursor);
      if (accumulated >= target) return cursor;
    }
    throw new Error(`addWorkingDays exceeded ${MAX_SCAN_DAYS} days from ${from} on ${calendarId}`);
  }

  /** Tổng capacity của các ngày trong nửa khoảng [a, b). Âm khi a > b. */
  function workingDaysBetween(calendarId: string, a: DateOnly, b: DateOnly): number {
    if (a === b) return 0;
    const forward = a < b;
    const from = forward ? a : b;
    const to = forward ? b : a;

    let total = 0;
    let cursor = from;
    while (cursor < to) {
      total += capacityFromCalendar(calendarId, cursor);
      cursor = addDays(cursor, 1);
    }
    return forward ? total : -total;
  }

  function locationCalendar(locationId: string): string {
    const loc = locationById.get(locationId);
    if (loc === undefined) throw new Error(`Unknown location: ${locationId}`);
    return loc.calendarId;
  }

  return {
    capacityOn,
    workSlots,
    isWorking,
    capacityOfCalendar: capacityFromCalendar,
    addWorkingDays,
    workingDaysBetween,
    nextWorkingDay,
    isWorkingAtLocation: (locationId, date) => isWorking(locationCalendar(locationId), date),
    nextWorkingDayAtLocation: (locationId, from) =>
      nextWorkingDay(locationCalendar(locationId), from),
  };
}
