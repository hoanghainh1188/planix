/**
 * CPM pha A — SPEC.md §7.2.
 *
 * Giả định **nguồn lực vô hạn**. Chênh lệch giữa pha A và pha B chính là chi phí do
 * thiếu người, và đó là con số cần khi đàm phán thêm resource (§7.2).
 *
 * Quy ước ngày, viết ra vì §6.1 nói theo dòng thời gian liên tục còn ta làm theo ngày:
 *
 *   ES là ngày làm việc ĐẦU TIÊN của task, EF là ngày làm việc CUỐI CÙNG — cả hai đều
 *   thuộc về task. Task duration 1 bắt đầu thứ Hai thì kết thúc thứ Hai.
 *
 *   Vì `finish` là cuối ngày EF còn `start` là đầu ngày ES, "pred.finish + lag 0" chính
 *   là đầu ngày làm việc kế tiếp. FS lag 0 nghĩa là successor bắt đầu ngày làm kế tiếp;
 *   lag L là L ngày làm việc trống ở giữa. Lag âm cho chồng lấn (§6.1).
 *
 * Hàm thuần (CLAUDE.md §3): mọi số học ngày đi qua CalendarEngine truyền vào.
 */

import type { CalendarEngine } from './calendar.js';
import { addDays, type DateOnly } from './date-only.js';
import type { DepEdge } from './dependency.js';
import type { ConstraintType } from './validation-types.js';

export interface CpmTask {
  readonly uid: string;
  /** Duration danh nghĩa theo ngày làm việc, đã làm tròn lên bội số 0.5 (§7.2). */
  readonly durationDays: number;
  readonly constraintType: ConstraintType | null;
  readonly constraintDate: DateOnly | null;
}

export interface CpmInput {
  readonly tasks: readonly CpmTask[];
  readonly edges: readonly DepEdge[];
  readonly projectStart: DateOnly;
  /** Lịch B — luôn là lịch của `project.default_location` (§6.1). */
  readonly calendarId: string;
  readonly engine: CalendarEngine;
}

export interface CpmRow {
  readonly es: DateOnly;
  readonly ef: DateOnly;
  readonly ls: DateOnly;
  readonly lf: DateOnly;
  readonly totalFloat: number;
  readonly isCritical: boolean;
}

const MAX_SCAN_DAYS = 4000;

export function runCpm(input: CpmInput): Map<string, CpmRow> {
  const { tasks, edges, projectStart, calendarId, engine } = input;
  const byUid = new Map(tasks.map((t) => [t.uid, t]));

  const cap = (date: DateOnly): number => engine.capacityOfCalendar(calendarId, date);

  /** Ngày làm việc đầu tiên tại hoặc sau `from`. */
  const snapForward = (from: DateOnly): DateOnly => engine.nextWorkingDay(calendarId, from);

  /** Ngày làm việc cuối cùng tại hoặc trước `from`. */
  function snapBackward(from: DateOnly): DateOnly {
    let cursor = from;
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      if (cap(cursor) > 0) return cursor;
      cursor = addDays(cursor, -1);
    }
    throw new Error(`No working day found before ${from}`);
  }

  /** EF từ ES: ngày mà capacity tích luỹ TỪ ES (kể cả ES) đạt `duration`. */
  function finishFrom(start: DateOnly, duration: number): DateOnly {
    const snapped = snapForward(start);
    if (duration <= 0) return snapped;
    let acc = 0;
    let cursor = snapped;
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      acc += cap(cursor);
      if (acc >= duration) return cursor;
      cursor = addDays(cursor, 1);
    }
    throw new Error(`Task duration ${duration} exceeds ${MAX_SCAN_DAYS} days from ${start}`);
  }

  /** ES từ EF: đi ngược cho tới khi capacity tích luỹ đạt `duration`. */
  function startFrom(finish: DateOnly, duration: number): DateOnly {
    const snapped = snapBackward(finish);
    if (duration <= 0) return snapped;
    let acc = 0;
    let cursor = snapped;
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      acc += cap(cursor);
      if (acc >= duration) return cursor;
      cursor = addDays(cursor, -1);
    }
    throw new Error(`Task duration ${duration} exceeds ${MAX_SCAN_DAYS} days before ${finish}`);
  }

  /** Ngày làm việc kế tiếp SAU `from` (không tính chính nó). */
  const dayAfter = (from: DateOnly): DateOnly => engine.addWorkingDays(calendarId, from, 1);
  const dayBefore = (from: DateOnly): DateOnly => engine.addWorkingDays(calendarId, from, -1);

  const shift = (from: DateOnly, days: number): DateOnly =>
    days === 0 ? from : engine.addWorkingDays(calendarId, from, days);

  // ── Topo sort. Thứ tự duyệt cố định theo uid để kết quả tái lập (N2) ───────
  const successors = new Map<string, DepEdge[]>();
  const indegree = new Map<string, number>();
  for (const t of tasks) indegree.set(t.uid, 0);
  for (const e of edges) {
    if (!byUid.has(e.predUid) || !byUid.has(e.succUid)) continue;
    const list = successors.get(e.predUid);
    if (list === undefined) successors.set(e.predUid, [e]);
    else list.push(e);
    indegree.set(e.succUid, (indegree.get(e.succUid) ?? 0) + 1);
  }
  for (const list of successors.values()) {
    list.sort((a, b) => (a.succUid < b.succUid ? -1 : a.succUid > b.succUid ? 1 : 0));
  }

  const ready = [...tasks.map((t) => t.uid)].filter((uid) => (indegree.get(uid) ?? 0) === 0).sort();
  const order: string[] = [];
  const pending = new Map(indegree);
  while (ready.length > 0) {
    const uid = ready.shift();
    if (uid === undefined) break;
    order.push(uid);
    for (const e of successors.get(uid) ?? []) {
      const left = (pending.get(e.succUid) ?? 0) - 1;
      pending.set(e.succUid, left);
      if (left === 0) {
        // Chèn giữ thứ tự uid tăng dần thay vì push rồi sort lại cả mảng.
        const at = ready.findIndex((x) => x > e.succUid);
        if (at === -1) ready.push(e.succUid);
        else ready.splice(at, 0, e.succUid);
      }
    }
  }
  if (order.length !== tasks.length) {
    throw new Error('Dependency cycle detected; CPM cannot run (see C01).');
  }

  // ── Forward pass → ES, EF (§7.2) ──────────────────────────────────────────
  const predecessors = new Map<string, DepEdge[]>();
  for (const e of edges) {
    if (!byUid.has(e.predUid) || !byUid.has(e.succUid)) continue;
    const list = predecessors.get(e.succUid);
    if (list === undefined) predecessors.set(e.succUid, [e]);
    else list.push(e);
  }

  const es = new Map<string, DateOnly>();
  const ef = new Map<string, DateOnly>();

  for (const uid of order) {
    const t = byUid.get(uid);
    if (t === undefined) continue;

    let earliest = snapForward(projectStart);

    for (const e of predecessors.get(uid) ?? []) {
      const pStart = es.get(e.predUid);
      const pFinish = ef.get(e.predUid);
      if (pStart === undefined || pFinish === undefined) continue;

      let bound: DateOnly;
      switch (e.type) {
        case 'FS':
          // succ.start >= pred.finish + lag → đầu ngày làm kế tiếp, rồi dịch thêm lag.
          bound = shift(dayAfter(pFinish), e.lagDays);
          break;
        case 'SS':
          bound = shift(pStart, e.lagDays);
          break;
        case 'FF':
          // §6.1: quy về start = (cận dưới của finish) − duration.
          bound = startFrom(shift(pFinish, e.lagDays), t.durationDays);
          break;
        case 'SF':
          bound = startFrom(shift(pStart, e.lagDays), t.durationDays);
          break;
      }
      if (bound > earliest) earliest = bound;
    }

    // §6.6 — SNET là cận dưới cứng; MSO ép cứng; FNLT chỉ kiểm tra, KHÔNG đẩy ngược.
    if (t.constraintDate !== null) {
      if (t.constraintType === 'SNET' && t.constraintDate > earliest) {
        earliest = t.constraintDate;
      } else if (t.constraintType === 'MSO') {
        earliest = t.constraintDate;
      }
    }

    const start = snapForward(earliest);
    es.set(uid, start);
    ef.set(uid, finishFrom(start, t.durationDays));
  }

  // ── Backward pass → LS, LF ────────────────────────────────────────────────
  let projectFinish = snapForward(projectStart);
  for (const uid of order) {
    const f = ef.get(uid);
    if (f !== undefined && f > projectFinish) projectFinish = f;
  }

  const ls = new Map<string, DateOnly>();
  const lf = new Map<string, DateOnly>();

  for (let i = order.length - 1; i >= 0; i--) {
    const uid = order[i];
    if (uid === undefined) continue;
    const t = byUid.get(uid);
    if (t === undefined) continue;

    let latestFinish = projectFinish;

    for (const e of successors.get(uid) ?? []) {
      const sStart = ls.get(e.succUid);
      const sFinish = lf.get(e.succUid);
      if (sStart === undefined || sFinish === undefined) continue;

      let bound: DateOnly;
      switch (e.type) {
        case 'FS':
          bound = shift(dayBefore(sStart), -e.lagDays);
          break;
        case 'SS':
          // pred.LS <= succ.LS − lag → quy về finish.
          bound = finishFrom(shift(sStart, -e.lagDays), t.durationDays);
          break;
        case 'FF':
          bound = shift(sFinish, -e.lagDays);
          break;
        case 'SF':
          bound = finishFrom(shift(sFinish, -e.lagDays), t.durationDays);
          break;
      }
      if (bound < latestFinish) latestFinish = bound;
    }

    const finish = snapBackward(latestFinish);
    lf.set(uid, finish);
    ls.set(uid, startFrom(finish, t.durationDays));
  }

  // ── Float và critical path ────────────────────────────────────────────────
  const out = new Map<string, CpmRow>();
  for (const uid of order) {
    const a = es.get(uid);
    const b = ef.get(uid);
    const c = ls.get(uid);
    const e2 = lf.get(uid);
    if (a === undefined || b === undefined || c === undefined || e2 === undefined) continue;

    // total_float = LS − ES, đo bằng NGÀY LÀM VIỆC chứ không phải ngày lịch: hai task
    // cách nhau một cuối tuần không vì thế mà có thêm float.
    const totalFloat = engine.workingDaysBetween(calendarId, a, c);
    out.set(uid, { es: a, ef: b, ls: c, lf: e2, totalFloat, isCritical: totalFloat === 0 });
  }
  return out;
}
