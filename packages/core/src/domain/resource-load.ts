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
  /**
   * Khối lượng THẬT của task, tính bằng người-ngày.
   *
   * Đây mới là thứ dùng để rải tải, không phải `allocation` — xem `spreadOf`.
   */
  readonly effortMd: number;
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

/**
 * Tải mỗi ngày của một lượt đặt chỗ.
 *
 * ## Vì sao KHÔNG dùng `allocation × năng lực ngày`
 *
 * `assignment.from_date`/`to_date` là **bao ngoài**, không phải danh sách ngày làm. SGS
 * giữ chỗ trên một số ngày CỤ THỂ bên trong khoảng đó (`reserveDays(res, best.days, …)`)
 * rồi ghi ra hai đầu mút; những ngày không được giữ nằm lẫn trong khoảng mà không có dấu
 * hiệu gì. Bảng DB không lưu danh sách ngày.
 *
 * Nên nhân `allocation` với mọi ngày làm trong khoảng là đếm cả những ngày người đó
 * KHÔNG làm task này. Đo trên `data/dev.db`: cách đó cho tổng **1047,5 MD** trong khi
 * tổng effort thật chỉ **837,0 MD** — phóng đại 1,25× trên toàn bộ, và tới **7×** với
 * một task mỏng như `T-0751` (3 MD trải trên 21 ngày làm mà `allocation = 1`).
 *
 * Hệ quả nhìn thấy được: màn pool báo một người 260% trong một tuần, và 200% của con số
 * đó đến từ MỘT dự án duy nhất — tức là con số đang nói dối, không phải lịch đang hỏng.
 *
 * ## Cách tính thay thế
 *
 * Rải `effort_md` theo tỷ lệ năng lực từng ngày trong bao ngoài. Tổng cộng lại đúng bằng
 * effort — bất biến quan trọng nhất — và ngày nghỉ nhận 0 thay vì nhận phần đều. Đây là
 * bản làm mịn của thứ engine thật sự làm; nó không nói được NGÀY NÀO người đó ngồi vào
 * việc, nhưng không bao giờ phóng đại tổng.
 */
function spreadOf(
  span: LoadSpan,
  capacityOn: (resourceId: string, date: DateOnly) => number,
): (date: DateOnly) => number {
  let totalCapacity = 0;
  for (let day = span.fromDate; compareDateOnly(day, span.toDate) <= 0; day = addDays(day, 1)) {
    totalCapacity += capacityOn(span.resourceId, day);
  }
  // Bao ngoài rơi trọn vào ngày nghỉ: không có ngày nào để rải, nên không tính gì.
  if (totalCapacity <= 0) return () => 0;

  const perCapacity = span.effortMd / totalCapacity;
  return (date) => capacityOn(span.resourceId, date) * perCapacity;
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
    const mine = (byResource.get(resourceId) ?? []).map((s) => ({
      span: s,
      load: spreadOf(s, capacityOn),
    }));
    const allocated = new Map<string, number>();
    const other = new Map<string, number>();
    const capacity = new Map<string, number>();

    for (const { date, bucket: label } of days) {
      const cap = capacityOn(resourceId, date);
      if (cap > 0) capacity.set(label, (capacity.get(label) ?? 0) + cap);
      if (cap <= 0) continue;

      for (const { span, load } of mine) {
        if (compareDateOnly(date, span.fromDate) < 0) continue;
        if (compareDateOnly(date, span.toDate) > 0) continue;
        const md = load(date);
        if (span.projectId === projectId) {
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

// ── S9 — Resource pool xuyên dự án (§10.3, §7.12) ────────────────────────────

export interface PoolSpan extends LoadSpan {
  readonly projectCode: string;
}

export interface PoolProjectShare {
  readonly projectId: string;
  readonly projectCode: string;
  readonly md: number;
}

export interface PoolRow {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly cells: readonly LoadCell[];
  readonly totalAllocatedMd: number;
  readonly totalCapacityMd: number;
  /** Ai đang giữ người này, tính trên CẢ cửa sổ — trả lời "dự án nào đang tranh". */
  readonly byProject: readonly PoolProjectShare[];
  /** `true` khi có ít nhất một kỳ bị đặt quá năng lực. */
  readonly overbooked: boolean;
}

/**
 * Ma trận người × kỳ trên TOÀN BỘ pool, không thuộc dự án nào.
 *
 * Khác `resourceLoad` ở chỗ nó không chia "của tôi / của người khác": S9 đứng ngoài mọi
 * dự án (§10.3 — "thuộc về tổ chức"), nên câu hỏi không phải "dự án tôi chiếm bao nhiêu"
 * mà là "ai đang giữ người này, và có ai bị đặt quá tay không".
 *
 * §7.12 là lý do màn này tồn tại: `resource` là tài nguyên toàn cục và các dự án tranh
 * nhau theo `priority`. `J14` nói được dự án nào chiếm chỗ, nhưng không nói được hình
 * dạng của sự tranh chấp — ai căng, căng vào tuần nào.
 *
 * Dùng chung `bucketOf` và trần cửa sổ với `resourceLoad`: hai định nghĩa kỳ khác nhau
 * cho cùng một khái niệm "tuần" sẽ cho hai bảng không khớp nhau.
 */
export function poolLoad(input: {
  readonly spans: readonly PoolSpan[];
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly bucket: LoadBucket;
  readonly capacityOn: (resourceId: string, date: DateOnly) => number;
  readonly resources: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}): { buckets: string[]; rows: PoolRow[] } {
  const { spans, from, to, bucket, capacityOn, resources } = input;
  if (compareDateOnly(from, to) > 0) return { buckets: [], rows: [] };

  const byResource = new Map<string, PoolSpan[]>();
  for (const s of spans) {
    const list = byResource.get(s.resourceId);
    if (list === undefined) byResource.set(s.resourceId, [s]);
    else list.push(s);
  }

  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  const days: Array<{ date: DateOnly; bucket: string }> = [];
  let count = 0;
  for (let day = from; compareDateOnly(day, to) <= 0; day = addDays(day, 1)) {
    count += 1;
    if (count > MAX_DAYS) throw new LoadWindowTooWideError(count);
    const label = bucketOf(day, bucket);
    if (!seen.has(label)) {
      seen.add(label);
      bucketOrder.push(label);
    }
    days.push({ date: day, bucket: label });
  }

  const rows: PoolRow[] = [];
  // Sắp theo id: thứ tự dòng không được phụ thuộc thứ tự mảng vào (N2).
  for (const res of [...resources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const mine = (byResource.get(res.id) ?? []).map((s) => ({
      span: s,
      load: spreadOf(s, capacityOn),
    }));
    const allocated = new Map<string, number>();
    const capacity = new Map<string, number>();
    const perProject = new Map<string, { code: string; md: number }>();

    for (const { date, bucket: label } of days) {
      const cap = capacityOn(res.id, date);
      if (cap <= 0) continue;
      capacity.set(label, (capacity.get(label) ?? 0) + cap);

      for (const { span, load } of mine) {
        if (compareDateOnly(date, span.fromDate) < 0) continue;
        if (compareDateOnly(date, span.toDate) > 0) continue;
        const md = load(date);
        allocated.set(label, (allocated.get(label) ?? 0) + md);
        const entry = perProject.get(span.projectId);
        if (entry === undefined) perProject.set(span.projectId, { code: span.projectCode, md });
        else entry.md += md;
      }
    }

    let totalAllocatedMd = 0;
    let totalCapacityMd = 0;
    let overbooked = false;
    const cells = bucketOrder.map((label) => {
      const md = round2(allocated.get(label) ?? 0);
      const capMd = round2(capacity.get(label) ?? 0);
      totalAllocatedMd += md;
      totalCapacityMd += capMd;
      const utilisation = capMd > 0 ? round2(md / capMd) : null;
      // Quá 1 nghĩa là người này bị hai dự án đặt chồng lên nhau — đúng thứ §7.12 sinh ra
      // để tránh, và đúng thứ PM cần thấy khi lịch của mình bị đẩy.
      if (utilisation !== null && utilisation > 1) overbooked = true;
      return { bucket: label, allocatedMd: md, capacityMd: capMd, utilisation, otherProjectMd: 0 };
    });

    rows.push({
      resourceId: res.id,
      resourceName: res.name,
      cells,
      totalAllocatedMd: round2(totalAllocatedMd),
      totalCapacityMd: round2(totalCapacityMd),
      byProject: [...perProject.entries()]
        .map(([projectId, v]) => ({ projectId, projectCode: v.code, md: round2(v.md) }))
        // Nhiều MD nhất lên trước; tie-break bằng mã để thứ tự xác định (N2).
        .sort((a, b) => b.md - a.md || (a.projectCode < b.projectCode ? -1 : 1)),
      overbooked,
    });
  }

  return { buckets: bucketOrder, rows };
}
