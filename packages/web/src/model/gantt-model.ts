/**
 * Hình học của Gantt — SPEC.md §10.3 (S3), §14.2/P9.
 *
 * N3 tuyệt đối: màn này CHỈ XEM. Ở đây chỉ có phép đổi ngày → toạ độ, không có đường nào
 * đi ngược lại. Tách ra khỏi component để test được bằng số, không cần chụp màn hình.
 */

import { toEpochDay, unsafeDateOnly } from '@planix/core/domain/date-only.js';

export interface GanttRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: string;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly isCritical: boolean;
  readonly pic: string | null;
  readonly teamId: string | null;
  readonly phase: string | null;
}

export interface TimelineTick {
  readonly label: string;
  readonly dayOffset: number;
}

export interface Timeline {
  readonly start: string;
  readonly end: string;
  /** Số ngày LỊCH, tính cả hai đầu. 0 khi chưa có gì được xếp lịch. */
  readonly totalDays: number;
  readonly ticks: readonly TimelineTick[];
}

const EMPTY: Timeline = { start: '', end: '', totalDays: 0, ticks: [] };

export function buildTimeline(rows: readonly GanttRow[]): Timeline {
  let start: string | null = null;
  let end: string | null = null;

  for (const row of rows) {
    if (row.planStart !== null && (start === null || row.planStart < start)) start = row.planStart;
    if (row.planEnd !== null && (end === null || row.planEnd > end)) end = row.planEnd;
  }
  if (start === null || end === null) return EMPTY;

  const totalDays = dayDiff(start, end) + 1;
  return { start, end, totalDays, ticks: monthTicks(start, totalDays) };
}

/** Mốc theo tháng: với dự án dài 6–12 tháng, mốc tuần sẽ dày đặc tới mức không đọc được. */
function monthTicks(start: string, totalDays: number): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  const [y0, m0] = splitYm(start);
  let year = y0;
  let month = m0;

  for (let guard = 0; guard < 240; guard++) {
    const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const offset = dayDiff(start, first);
    if (offset >= totalDays) break;
    // Mốc đầu tiên có thể nằm trước `start`; ghim nó về 0 để nhãn không tràn ra ngoài.
    ticks.push({ label: first.slice(0, 7), dayOffset: Math.max(0, offset) });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return ticks;
}

function splitYm(date: string): [number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
}

function dayDiff(from: string, to: string): number {
  return toEpochDay(unsafeDateOnly(to)) - toEpochDay(unsafeDateOnly(from));
}

/**
 * Số ngày lịch giữa hai mốc, dùng cho vạch `status_date`.
 *
 * Đi qua `toEpochDay` của core chứ không dùng `Date.parse`: cùng một phép tính ngày cho
 * cả engine lẫn UI thì hai bên không thể lệch nhau ở biên múi giờ.
 */
export function dayOffset(from: string, to: string): number {
  return dayDiff(from, to);
}

export interface GanttBar {
  readonly row: GanttRow;
  readonly x: number;
  readonly width: number;
}

/**
 * Đổi mỗi dòng có lịch thành một thanh.
 *
 * Bề rộng tính CẢ ngày cuối: task từ 02 tới 06 chiếm 5 ngày, không phải 4. Task một ngày
 * vẫn phải nhìn thấy được, nếu không mốc (milestone) sẽ biến mất khỏi biểu đồ.
 */
export function ganttBars(
  rows: readonly GanttRow[],
  timeline: Timeline,
  dayWidth: number,
): GanttBar[] {
  if (timeline.totalDays === 0) return [];

  const bars: GanttBar[] = [];
  for (const row of rows) {
    if (row.planStart === null || row.planEnd === null) continue;
    const x = dayDiff(timeline.start, row.planStart) * dayWidth;
    const width = Math.max(dayWidth, (dayDiff(row.planStart, row.planEnd) + 1) * dayWidth);
    bars.push({ row, x, width });
  }
  return bars;
}

/** Giá trị duy nhất cho ô lọc, bỏ null, sắp xếp để thứ tự không đổi giữa các lần render. */
export function distinct(
  rows: readonly GanttRow[],
  pick: (row: GanttRow) => string | null,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && value !== '') set.add(value);
  }
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
