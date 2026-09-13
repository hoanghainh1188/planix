/**
 * Baseline và so sánh với baseline — SPEC.md §7.13, §12.1.
 *
 * Baseline đầu tiên (`Plan v1.0`) là **mốc cam kết**: mọi so sánh scope creep dựa vào
 * nó (§7.13). Baseline không xoá được, chỉ đánh dấu `is_hidden`.
 *
 * Hàm thuần (CLAUDE.md §3): dựng chuỗi và so sánh, không đụng DB.
 */

import { toEpochDay, type DateOnly } from './date-only.js';
import type { ProgressStatus } from './validation-types.js';

export interface BaselineTask {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly effortMd: number;
  readonly startDate: DateOnly | null;
  readonly endDate: DateOnly | null;
  readonly status: ProgressStatus;
  readonly percent: number;
}

/**
 * Chuỗi JSON của ảnh chụp, dùng cho `baseline.snapshot_json`.
 *
 * Sắp theo uid và serialize với khoá cố định: chốt cùng một trạng thái hai lần phải cho
 * cùng một chuỗi, nếu không thì so sánh baseline về sau sẽ thấy khác biệt giả.
 */
export function buildBaselineSnapshot(tasks: readonly BaselineTask[], statusDate: string): string {
  const ordered = [...tasks]
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
    .map((t) => ({
      uid: t.uid,
      wbsCode: t.wbsCode,
      name: t.name,
      effortMd: t.effortMd,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      percent: t.percent,
    }));
  return JSON.stringify({ statusDate, tasks: ordered });
}

export interface EffortChange {
  readonly uid: string;
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}

export interface DateSlip {
  readonly uid: string;
  readonly from: DateOnly;
  readonly to: DateOnly;
  /** Dương là trượt muộn, âm là về sớm. Đếm theo ngày lịch. */
  readonly days: number;
}

export interface BaselineDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly effortChanged: readonly EffortChange[];
  readonly slipped: readonly DateSlip[];
  /** Tổng MD của task mới thêm — con số nói thẳng về scope creep (§7.13). */
  readonly addedEffortMd: number;
}

export function diffBaseline(
  baseline: readonly BaselineTask[],
  current: readonly BaselineTask[],
): BaselineDiff {
  const baseByUid = new Map(baseline.map((t) => [t.uid, t]));
  const curByUid = new Map(current.map((t) => [t.uid, t]));

  const added: string[] = [];
  let addedEffortMd = 0;
  for (const t of current) {
    if (!baseByUid.has(t.uid)) {
      added.push(t.uid);
      addedEffortMd += t.effortMd;
    }
  }

  const removed = baseline.filter((t) => !curByUid.has(t.uid)).map((t) => t.uid);

  const effortChanged: EffortChange[] = [];
  const slipped: DateSlip[] = [];
  for (const t of current) {
    const before = baseByUid.get(t.uid);
    if (before === undefined) continue;

    if (before.effortMd !== t.effortMd) {
      effortChanged.push({
        uid: t.uid,
        from: before.effortMd,
        to: t.effortMd,
        delta: t.effortMd - before.effortMd,
      });
    }

    if (before.endDate !== null && t.endDate !== null && before.endDate !== t.endDate) {
      slipped.push({
        uid: t.uid,
        from: before.endDate,
        to: t.endDate,
        days: toEpochDay(t.endDate) - toEpochDay(before.endDate),
      });
    }
  }

  const byUid = (a: { uid: string }, b: { uid: string }): number =>
    a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;

  return {
    added: added.sort(),
    removed: removed.sort(),
    effortChanged: effortChanged.sort(byUid),
    slipped: slipped.sort(byUid),
    addedEffortMd,
  };
}
