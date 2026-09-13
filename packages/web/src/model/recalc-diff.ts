/**
 * Bảng so sánh trước/sau khi recalculate — SPEC.md §10.1, §14.2 P8.
 *
 * §10.1: "Trước khi ghi kết quả recalculate, hiện bảng so sánh trước/sau: task nào
 * trượt, trượt mấy ngày, ngày kết thúc dự án đổi bao nhiêu, dự án nào bị ảnh hưởng.
 * PM xác nhận rồi mới lưu."
 *
 * Gộp MỌI dự án bị ảnh hưởng, không chỉ dự án đang mở. §15 `R9` nêu đúng rủi ro này:
 * "Hiệu ứng lan xuyên dự án, PM dự án khác không biết."
 */

export interface ScheduleSnapshotRow {
  readonly taskUid: string;
  readonly projectId: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface TaskSlip {
  readonly taskUid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly from: string | null;
  readonly to: string | null;
  /** Dương là trượt muộn, âm là về sớm. Ngày lịch. */
  readonly days: number;
}

export interface ProjectImpact {
  readonly projectId: string;
  readonly slipped: readonly TaskSlip[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Ngày kết thúc dự án trước và sau. */
  readonly endBefore: string | null;
  readonly endAfter: string | null;
  readonly endShiftDays: number;
}

export interface RecalcDiff {
  /** Dự án bị ảnh hưởng, sắp theo mức trượt giảm dần rồi tới id. */
  readonly projects: readonly ProjectImpact[];
  readonly totalSlipped: number;
  /** true khi có dự án KHÁC dự án đang mở bị ảnh hưởng — cảnh báo `R9`. */
  readonly touchesOtherProjects: boolean;
}

function daysBetween(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function maxEnd(rows: readonly ScheduleSnapshotRow[]): string | null {
  let max: string | null = null;
  for (const r of rows) {
    if (r.endDate === null) continue;
    if (max === null || r.endDate > max) max = r.endDate;
  }
  return max;
}

export function buildRecalcDiff(
  before: readonly ScheduleSnapshotRow[],
  after: readonly ScheduleSnapshotRow[],
  currentProjectId: string,
): RecalcDiff {
  const projectIds = [
    ...new Set([...before.map((r) => r.projectId), ...after.map((r) => r.projectId)]),
  ].sort();

  const beforeByUid = new Map(before.map((r) => [r.taskUid, r]));
  const afterByUid = new Map(after.map((r) => [r.taskUid, r]));

  const impacts: ProjectImpact[] = [];

  for (const projectId of projectIds) {
    const b = before.filter((r) => r.projectId === projectId);
    const a = after.filter((r) => r.projectId === projectId);

    const slipped: TaskSlip[] = [];
    for (const row of a) {
      const old = beforeByUid.get(row.taskUid);
      if (old === undefined) continue;
      if (old.endDate === row.endDate) continue;
      slipped.push({
        taskUid: row.taskUid,
        wbsCode: row.wbsCode,
        name: row.name,
        from: old.endDate,
        to: row.endDate,
        days: daysBetween(old.endDate, row.endDate),
      });
    }
    // Trượt nhiều nhất lên đầu: PM cần thấy thiệt hại lớn nhất trước, không phải đọc hết.
    slipped.sort((x, y) => {
      if (Math.abs(y.days) !== Math.abs(x.days)) return Math.abs(y.days) - Math.abs(x.days);
      return x.taskUid < y.taskUid ? -1 : 1;
    });

    const added = a
      .filter((r) => !beforeByUid.has(r.taskUid))
      .map((r) => r.taskUid)
      .sort();
    const removed = b
      .filter((r) => !afterByUid.has(r.taskUid))
      .map((r) => r.taskUid)
      .sort();

    const endBefore = maxEnd(b);
    const endAfter = maxEnd(a);

    // Dự án không đổi gì thì không đưa vào bảng — bảng đầy dòng "không đổi" là bảng
    // không ai đọc, và cảnh báo R9 sẽ chìm nghỉm giữa chúng.
    if (
      slipped.length === 0 &&
      added.length === 0 &&
      removed.length === 0 &&
      endBefore === endAfter
    ) {
      continue;
    }

    impacts.push({
      projectId,
      slipped,
      added,
      removed,
      endBefore,
      endAfter,
      endShiftDays: daysBetween(endBefore, endAfter),
    });
  }

  impacts.sort((x, y) => {
    if (y.slipped.length !== x.slipped.length) return y.slipped.length - x.slipped.length;
    return x.projectId < y.projectId ? -1 : 1;
  });

  return {
    projects: impacts,
    totalSlipped: impacts.reduce((sum, p) => sum + p.slipped.length, 0),
    touchesOtherProjects: impacts.some((p) => p.projectId !== currentProjectId),
  };
}
