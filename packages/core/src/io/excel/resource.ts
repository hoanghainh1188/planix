/**
 * Bản `resource` — SPEC.md §11.1: "Ma trận người × tuần, đơn vị MD".
 *
 * Dành cho quản lý cấp trên, nên câu hỏi nó trả lời là "tuần này ai đang gánh bao nhiêu",
 * không phải "task nào chạy khi nào".
 *
 * MD tính bằng cách rải `allocation` lên từng NGÀY LÀM VIỆC trong khoảng gán. Không chia
 * đều theo ngày lịch: một khoảng bắc qua cuối tuần hay lễ Nhật sẽ ra số sai, và đó đúng
 * là loại sai mà cấp trên không bao giờ phát hiện được.
 */

import type ExcelJS from 'exceljs';
import {
  addDays,
  dayOfWeekMon0,
  toEpochDay,
  unsafeDateOnly,
  type DateOnly,
} from '../../domain/date-only.js';

export interface Span {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly from: string;
  readonly to: string;
  readonly allocation: number;
}

/** Thứ Hai của tuần chứa ngày này. */
export function weekStart(date: DateOnly): DateOnly {
  return addDays(date, -dayOfWeekMon0(date));
}

export interface Matrix {
  readonly weeks: readonly string[];
  /** resourceId → tên, giữ thứ tự để hai lần xuất ra cùng một bảng (§11.5). */
  readonly people: ReadonlyArray<{ id: string; name: string }>;
  /** `${resourceId}|${weekStart}` → MD. */
  readonly cells: ReadonlyMap<string, number>;
}

/**
 * @param isWorking ngày đó có phải ngày làm việc của người này không. Lớp gọi truyền vào
 *                  từ CalendarEngine — domain không đọc lịch (CLAUDE.md §3).
 */
export function buildMatrix(
  spans: readonly Span[],
  isWorking: (resourceId: string, date: DateOnly) => boolean,
): Matrix {
  const cells = new Map<string, number>();
  const weeks = new Set<string>();
  const people = new Map<string, string>();

  for (const span of spans) {
    people.set(span.resourceId, span.resourceName);

    const from = unsafeDateOnly(span.from);
    const to = unsafeDateOnly(span.to);
    const days = toEpochDay(to) - toEpochDay(from);
    // Khoảng gán hỏng (to < from) thì bỏ qua, đừng lặp âm vô tận.
    if (days < 0) continue;

    for (let i = 0; i <= days; i++) {
      const day = addDays(from, i);
      if (!isWorking(span.resourceId, day)) continue;
      const wk = weekStart(day);
      weeks.add(wk);
      const key = `${span.resourceId}|${wk}`;
      cells.set(key, (cells.get(key) ?? 0) + span.allocation);
    }
  }

  return {
    weeks: [...weeks].sort(),
    people: [...people.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, name]) => ({ id, name })),
    cells,
  };
}

export function buildResourceSheet(
  wb: ExcelJS.Workbook,
  matrix: Matrix,
  statusDate: string,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Resource');

  ws.addRow([`Resource load in MD · as of ${statusDate}`]).font = { bold: true };
  ws.addRow([]);

  const header = ws.addRow(['Resource', ...matrix.weeks, 'Total']);
  header.font = { bold: true };
  ws.getColumn(1).width = 22;
  for (let i = 0; i < matrix.weeks.length + 1; i++) ws.getColumn(i + 2).width = 11;

  for (const person of matrix.people) {
    const values = matrix.weeks.map((w) => matrix.cells.get(`${person.id}|${w}`) ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const line = ws.addRow([person.name, ...values, total]);
    for (let i = 2; i <= matrix.weeks.length + 2; i++) line.getCell(i).numFmt = '0.##';
    line.getCell(matrix.weeks.length + 2).font = { bold: true };
  }

  // Hàng tổng theo tuần: cho thấy tuần nào cả đội bị dồn việc.
  const totals = matrix.weeks.map((w) =>
    matrix.people.reduce((sum, p) => sum + (matrix.cells.get(`${p.id}|${w}`) ?? 0), 0),
  );
  const last = ws.addRow(['Total', ...totals, totals.reduce((a, b) => a + b, 0)]);
  last.font = { bold: true };
  for (let i = 2; i <= matrix.weeks.length + 2; i++) last.getCell(i).numFmt = '0.##';

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: header.number }];
  return ws;
}
