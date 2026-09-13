/**
 * Tie-break — SPEC.md §7.4, "phần quan trọng nhất".
 *
 * So sánh **theo đúng thứ tự bậc**, gặp khác biệt là dừng. Bậc cuối của cả hai bảng là
 * chốt chặn: `uid` và `resource.id` đều là khoá chính nên không bao giờ hoà. Thiếu bậc
 * chốt thì kết quả phụ thuộc thứ tự dòng DB trả về, và M2 (cùng input ra cùng output,
 * byte-for-byte) sụp.
 */

import type { DateOnly } from './date-only.js';

export interface PriorityCandidate {
  readonly uid: string;
  /** 1 = cao nhất. */
  readonly priority: number;
  /** Late Start từ pha A. */
  readonly ls: DateOnly;
  readonly totalFloat: number;
  readonly wbsCode: string;
}

export interface ResourceCandidate {
  readonly resourceId: string;
  readonly expectedFinish: DateOnly;
  /** 1.0 chuẩn; 1.2 nghĩa là chậm hơn 20% (§4.2). */
  readonly proficiency: number;
  readonly assignedMd: number;
}

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Natural sort cho `wbs_code` (§7.4 bậc 4, §11.5).
 *
 * So chuỗi thuần sẽ đặt `1.10` TRƯỚC `1.9` vì ký tự `'1' < '9'`. Với cây WBS có hơn 9
 * anh em — chuyện thường ở 6.000 task — thứ tự sẽ sai ngay.
 */
export function compareWbsCode(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const n = Math.min(as.length, bs.length);

  for (let i = 0; i < n; i++) {
    const x = Number(as[i]);
    const y = Number(bs[i]);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      const s = cmpString(as[i] ?? '', bs[i] ?? '');
      if (s !== 0) return s;
      continue;
    }
    if (x !== y) return x - y;
  }
  // Cùng tiền tố thì mã ngắn hơn đứng trước: '1.2' trước '1.2.1'.
  return as.length - bs.length;
}

/** Chọn task nào trước. */
export function compareByPriorityKey(a: PriorityCandidate, b: PriorityCandidate): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.ls !== b.ls) return cmpString(a.ls, b.ls);
  if (a.totalFloat !== b.totalFloat) return a.totalFloat - b.totalFloat;
  const wbs = compareWbsCode(a.wbsCode, b.wbsCode);
  if (wbs !== 0) return wbs;
  return cmpString(a.uid, b.uid);
}

/** Chọn ai làm. */
export function compareByResourceKey(a: ResourceCandidate, b: ResourceCandidate): number {
  if (a.expectedFinish !== b.expectedFinish) return cmpString(a.expectedFinish, b.expectedFinish);
  if (a.proficiency !== b.proficiency) return a.proficiency - b.proficiency;
  if (a.assignedMd !== b.assignedMd) return a.assignedMd - b.assignedMd;
  return cmpString(a.resourceId, b.resourceId);
}
