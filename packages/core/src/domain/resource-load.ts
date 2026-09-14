/**
 * Ma trận người × kỳ — SPEC.md §12.1 `wbs_get_resource_load`.
 *
 * Trả lời đúng một câu: *trong mỗi kỳ, mỗi người đã bị đặt chỗ bao nhiêu so với năng lực
 * thật của họ?*
 *
 * ## Vì sao mẫu số là năng lực THẬT, không phải số ngày lịch
 *
 * Cùng lý do đã chốt cho `J06` (§8.2): lấy số ngày lịch làm mẫu số sẽ biến người nghỉ
 * phép dài thành người lười, và biến tuần có lễ Nhật thành tuần "rảnh". Mẫu số ở đây là
 * lịch A của chính người đó — đã trừ cuối tuần, lễ, và nghỉ phép cá nhân.
 *
 * ## Đơn vị
 *
 * Tất cả tính bằng **người-ngày** (MD). Một ngày làm nửa buổi ở mức `allocation = 0.5` là
 * `0.5 × 0.5 = 0.25` MD, không phải 0.5 — hai vế tử và mẫu cùng nhân với capacity nên
 * cùng đơn vị. Giống hệt quy ước `checkResourceUtilisation` đang dùng; lệch quy ước giữa
 * hai chỗ sẽ cho hai con số khác nhau cho cùng một câu hỏi.
 *
 * Hàm thuần (CLAUDE.md §3): nhận dữ liệu, trả dữ liệu. Không đọc DB, không đọc đồng hồ.
 */

import { addDays, compareDateOnly, dayOfWeekMon0, type DateOnly } from './date-only.js';

export type LoadBucket = 'day' | 'week' | 'month';

export interface LoadSpan {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  readonly allocation: number;
  /** Dự án giữ chỗ này. Cần để tách phần của dự án đang xét khỏi phần của dự án khác. */
  readonly projectId: string;
}

export interface LoadCell {
  /** Nhãn kỳ: `2026-01-05` (ngày), `2026-W02` (tuần), `2026-01` (tháng). */
  readonly bucket: string;
  /** Người-ngày đã bị đặt chỗ trong kỳ. */
  readonly allocatedMd: number;
  /** Người-ngày người đó THỰC SỰ có trong kỳ (lịch A). */
  readonly capacityMd: number;
  /** `allocatedMd / capacityMd`, làm tròn 2 chữ số. `null` khi không có ngày làm nào. */
  readonly utilisation: number | null;
  /** Phần thuộc dự án khác — chỉ có khi hỏi `cross_project`. */
  readonly otherProjectMd: number;
}

export interface LoadRow {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly cells: readonly LoadCell[];
  readonly totalAllocatedMd: number;
  readonly totalCapacityMd: number;
}

export interface LoadInput {
  readonly spans: readonly LoadSpan[];
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly bucket: LoadBucket;
  /** Lịch A: năng lực của chính người đó trong một ngày (0 | 0.5 | 1). */
  readonly capacityOn: (resourceId: string, date: DateOnly) => number;
  /** Dự án đang xét — phần còn lại tính vào `otherProjectMd`. */
  readonly projectId: string;
  /** Người cần báo cáo. Truyền vào chứ không suy từ `spans`: người RẢNH không có span
   *  nào, mà "ai đang rảnh" lại chính là câu hỏi hay được hỏi nhất. */
  readonly resourceIds: readonly string[];
  readonly nameOf: (resourceId: string) => string;
}

/** Nhãn kỳ chứa `date`. Tuần bắt đầu thứ Hai, theo `dayOfWeekMon0`. */
export function bucketOf(date: DateOnly, bucket: LoadBucket): string {
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);

  // Tuần: lùi về thứ Hai rồi lấy chính ngày đó làm nhãn. Dùng ngày thứ Hai chứ không
  // dùng số tuần ISO: số tuần ISO có những ca biên quanh giao thừa mà không ai nhớ nổi,
  // còn "tuần bắt đầu ngày này" thì đọc phát hiểu ngay và sắp xếp đúng bằng so chuỗi.
  return `W${addDays(date, -dayOfWeekMon0(date))}`;
}

/** Trần số ngày quét, để một khoảng gõ nhầm không treo tiến trình. */
const MAX_DAYS = 1100;

export class LoadWindowTooWideError extends Error {
  constructor(days: number) {
    super(`Resource load window is ${String(days)} days; the limit is ${String(MAX_DAYS)}.`);
    this.name = 'LoadWindowTooWideError';
  }
}

export function resourceLoad(input: LoadInput): { buckets: string[]; rows: LoadRow[] } {
  const { spans, from, to, bucket, capacityOn, projectId, resourceIds, nameOf } = input;
  if (compareDateOnly(from, to) > 0) return { buckets: [], rows: [] };

  const byResource = new Map<string, LoadSpan[]>();
  for (const s of spans) {
    const list = byResource.get(s.resourceId);
    if (list === undefined) byResource.set(s.resourceId, [s]);
    else list.push(s);
  }

  const bucketOrder: string[] = [];
  const seenBucket = new Set<string>();
  const days: Array<{ date: DateOnly; bucket: string }> = [];
  let count = 0;
  for (let day = from; compareDateOnly(day, to) <= 0; day = addDays(day, 1)) {
    count += 1;
    if (count > MAX_DAYS) throw new LoadWindowTooWideError(count);
    const label = bucketOf(day, bucket);
    if (!seenBucket.has(label)) {
      seenBucket.add(label);
      bucketOrder.push(label);
    }
    days.push({ date: day, bucket: label });
  }

  const rows: LoadRow[] = [];
  // Sắp theo id: thứ tự dòng không được phụ thuộc thứ tự mảng vào (N2).
  for (const resourceId of [...resourceIds].sort()) {
    const mine = byResource.get(resourceId) ?? [];
    const allocated = new Map<string, number>();
    const other = new Map<string, number>();
    const capacity = new Map<string, number>();

    for (const { date, bucket: label } of days) {
      const cap = capacityOn(resourceId, date);
      if (cap > 0) capacity.set(label, (capacity.get(label) ?? 0) + cap);
      if (cap <= 0) continue;

      for (const s of mine) {
        if (compareDateOnly(date, s.fromDate) < 0 || compareDateOnly(date, s.toDate) > 0) continue;
        const md = s.allocation * cap;
        if (s.projectId === projectId) {
          allocated.set(label, (allocated.get(label) ?? 0) + md);
        } else {
          other.set(label, (other.get(label) ?? 0) + md);
        }
      }
    }

    let totalAllocatedMd = 0;
    let totalCapacityMd = 0;
    const cells = bucketOrder.map((label) => {
      const mineMd = round2(allocated.get(label) ?? 0);
      const otherMd = round2(other.get(label) ?? 0);
      const capMd = round2(capacity.get(label) ?? 0);
      totalAllocatedMd += mineMd + otherMd;
      totalCapacityMd += capMd;
      return {
        bucket: label,
        allocatedMd: mineMd,
        capacityMd: capMd,
        // Tỷ lệ tính trên TỔNG đặt chỗ, kể cả của dự án khác: một người bận 100% ở nơi
        // khác không phải người rảnh, dù nhìn từ dự án này thì ô của họ trống.
        utilisation: capMd > 0 ? round2((mineMd + otherMd) / capMd) : null,
        otherProjectMd: otherMd,
      };
    });

    rows.push({
      resourceId,
      resourceName: nameOf(resourceId),
      cells,
      totalAllocatedMd: round2(totalAllocatedMd),
      totalCapacityMd: round2(totalCapacityMd),
    });
  }

  return { buckets: bucketOrder, rows };
}

/** Cộng dồn số thực sinh đuôi nhị phân. MD chỉ có nghĩa tới 2 chữ số. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
