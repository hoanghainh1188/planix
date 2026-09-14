/**
 * Read model cho báo cáo Excel (§11) và EVM (§7.13).
 *
 * Tách ra từ `read-repo.ts` (xem chú thích ở `wbs-repo.ts`).
 */

/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';
import { rollupTree, type RollupTask } from '../../domain/rollup.js';
import { isMicroTask } from '../../domain/rollup.js';
import { createCalendarEngine } from '../../domain/calendar.js';
import { unsafeDateOnly } from '../../domain/date-only.js';
import { loadCalendarSnapshot } from './calendar-repo.js';
import { listBaselines, readBaselineSnapshot } from './baseline-repo.js';
import { computeEvm, type EvmResult, type EvmTask } from '../../domain/evm.js';
import type { ProgressStatus, TaskKind } from '../../domain/validation-types.js';

// ── Read model cho báo cáo Excel (§11) ──────────────────────────────────────

export interface ReportRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
  /** §11.2 cột C: trống thì lấy `phase`. */
  readonly category: string | null;
  readonly pic: string | null;
  readonly status: string;
  readonly percent: number;
  readonly effortMd: number | null;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
  readonly isMicro: boolean;
  /** §11.2 cột L, đã dựng sẵn dạng `1.2.3 FS`, `2.1 SS+2`. */
  readonly dependsOn: string;
}

export interface ReportData {
  readonly projectCode: string;
  readonly projectName: string;
  readonly statusDate: string;
  readonly microThreshold: number;
  readonly rows: readonly ReportRow[];
}

/**
 * Toàn bộ dữ liệu một bản báo cáo cần, trong một lượt đọc.
 *
 * §11.5 đòi "cùng DB + cùng status_date → cùng file, kể cả thứ tự dòng", nên thứ tự ở
 * đây phải tất định. SQL `ORDER BY wbs_code` sắp theo chuỗi (1.10 trước 1.2), nên việc
 * sắp xếp để lớp gọi làm bằng natural sort — cùng một hàm với ba màn hình.
 */
export function loadReportData(db: Db, projectId: string): ReportData {
  const project = db
    .prepare('SELECT code, name, status_date, micro_task_threshold FROM project WHERE id = ?')
    .get(projectId) as
    { code: string; name: string; status_date: string; micro_task_threshold: number } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${projectId}`);

  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md,
              t.category, t.phase,
              r.name AS pic,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              p.actual_start, p.actual_end, p.blocked_note,
              s.start_date, s.end_date
       FROM task t
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource r   ON r.id = a.resource_id
       WHERE t.project_id = ?`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  // Nhãn dependency dựng bằng MỘT truy vấn cho cả dự án, không phải mỗi task một lần.
  const deps = new Map<string, string[]>();
  const depRows = db
    .prepare(
      `SELECT d.succ_uid, pt.wbs_code AS pred_code, d.type, d.lag_days
       FROM dependency d
       JOIN task pt ON pt.uid = d.pred_uid
       JOIN task st ON st.uid = d.succ_uid
       WHERE st.project_id = ?`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  for (const d of depRows) {
    const lag = d['lag_days'] as number;
    // §11.2 nêu ví dụ `2.1 SS+2`: chỉ ghi lag khi khác 0, và giữ dấu.
    const suffix = lag === 0 ? '' : lag > 0 ? `+${String(lag)}` : String(lag);
    const label = `${String(d['pred_code'])} ${String(d['type'])}${suffix}`;
    const succ = d['succ_uid'] as string;
    const list = deps.get(succ);
    if (list === undefined) deps.set(succ, [label]);
    else list.push(label);
  }
  // Sắp nhãn để hai lần xuất ra cùng một chuỗi (§11.5).
  for (const list of deps.values()) list.sort();

  const rollup = rollupTree(
    rows.map((r): RollupTask => ({
      uid: r['uid'] as string,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      kind: r['kind'] as TaskKind,
      effortMd: (r['effort_md'] as number | null) ?? null,
      status: r['status'] as ProgressStatus,
      percent: r['percent'] as number,
      planStart: (r['start_date'] as string | null) ?? null,
      planEnd: (r['end_date'] as string | null) ?? null,
    })),
  );

  const report = rows.map((r): ReportRow => {
    const uid = r['uid'] as string;
    const kind = r['kind'] as string;
    const isSummary = kind === 'summary';
    const rolled = rollup.get(uid);
    const effortMd = (r['effort_md'] as number | null) ?? null;

    return {
      uid,
      wbsCode: r['wbs_code'] as string,
      depth: r['depth'] as number,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      name: r['name'] as string,
      kind,
      // §11.2 cột C: "Trống thì lấy `phase`".
      category: (r['category'] as string | null) ?? (r['phase'] as string | null) ?? null,
      // §11.2 cột D: "Summary để trống".
      pic: isSummary ? null : ((r['pic'] as string | null) ?? null),
      status: rolled?.status ?? (r['status'] as string),
      percent: rolled?.percentDisplay ?? (r['percent'] as number),
      effortMd: isSummary ? (rolled?.effortRollup ?? null) : effortMd,
      planStart: rolled?.planStart ?? null,
      planEnd: rolled?.planEnd ?? null,
      actualStart: (r['actual_start'] as string | null) ?? null,
      actualEnd: (r['actual_end'] as string | null) ?? null,
      blockedNote: (r['blocked_note'] as string | null) ?? null,
      isMicro: isMicroTask({ kind: kind as TaskKind, effortMd }, project.micro_task_threshold),
      dependsOn: (deps.get(uid) ?? []).join(', '),
    };
  });

  return {
    projectCode: project.code,
    projectName: project.name,
    statusDate: project.status_date,
    microThreshold: project.micro_task_threshold,
    rows: report,
  };
}

export interface ResourceWeekCell {
  readonly resourceId: string;
  readonly resourceName: string;
  /** Thứ Hai của tuần, dạng YYYY-MM-DD. */
  readonly weekStart: string;
  readonly md: number;
}

/** Dữ liệu thô cho bản `resource` (§11.1): ai làm bao nhiêu MD trong tuần nào. */
export function loadAssignmentSpans(
  db: Db,
  projectId: string,
): Array<{
  resourceId: string;
  resourceName: string;
  from: string;
  to: string;
  allocation: number;
}> {
  const rows = db
    .prepare(
      `SELECT a.resource_id, r.name, a.from_date, a.to_date, a.allocation
       FROM assignment a
       JOIN task t     ON t.uid = a.task_uid
       JOIN resource r ON r.id = a.resource_id
       WHERE t.project_id = ?
       ORDER BY a.resource_id, a.from_date, a.task_uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    resourceName: r['name'] as string,
    from: r['from_date'] as string,
    to: r['to_date'] as string,
    allocation: r['allocation'] as number,
  }));
}

// ── EVM: ghép baseline với tiến độ hiện tại ─────────────────────────────────

export interface EvmReport extends EvmResult {
  readonly baselineId: string;
  readonly baselineLabel: string;
  readonly statusDate: string;
}

/**
 * Tính SPI cho một dự án so với một baseline.
 *
 * Không truyền `baselineId` thì lấy baseline **mới nhất**. §7.13 nói `Plan v1.0` là mốc
 * cam kết, nên muốn đo scope creep so với cam kết gốc thì phải chỉ đích danh nó.
 *
 * Trả `null` khi dự án chưa chốt baseline nào — EVM không có nghĩa nếu chưa có kế hoạch
 * gốc để so.
 */
export function loadEvm(db: Db, projectId: string, baselineId?: string): EvmReport | null {
  const baselines = listBaselines(db, projectId);
  const chosen =
    baselineId === undefined ? baselines[0] : baselines.find((b) => b.id === baselineId);
  if (chosen === undefined) return null;

  const project = db
    .prepare('SELECT status_date, calendar_id FROM project WHERE id = ?')
    .get(projectId) as { status_date: string; calendar_id: string } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${projectId}`);

  const snapshot = new Map(readBaselineSnapshot(db, chosen.id).map((r) => [r.uid, r]));

  // Trạng thái HIỆN TẠI của task lá. Summary bị loại: gộp chúng vào sẽ đếm hai lần.
  const current = db
    .prepare(
      `SELECT t.uid, t.effort_md,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent
       FROM task t
       LEFT JOIN progress p ON p.task_uid = t.uid
       WHERE t.project_id = ? AND t.kind != 'summary'`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const calendar = createCalendarEngine(loadCalendarSnapshot(db));
  const statusDate = project.status_date;

  const tasks: EvmTask[] = [];
  let outside = 0;

  for (const row of current) {
    const uid = row['uid'] as string;
    const base = snapshot.get(uid);

    if (base === undefined) {
      // Thêm vào sau khi chốt baseline — không tính vào BCWS/BCWP, báo riêng.
      outside += (row['effort_md'] as number | null) ?? 0;
      continue;
    }

    const start = base.startDate;
    const elapsed =
      start !== null && start <= statusDate
        ? calendar.workingDaysBetween(
            project.calendar_id,
            unsafeDateOnly(start),
            unsafeDateOnly(statusDate),
          )
        : 0;
    const duration =
      start !== null && base.endDate !== null
        ? calendar.workingDaysBetween(
            project.calendar_id,
            unsafeDateOnly(start),
            unsafeDateOnly(base.endDate),
          ) + 1
        : 0;

    tasks.push({
      uid,
      baselineMd: base.effortMd,
      baselineDurationDays: duration,
      elapsedWorkingDays: elapsed,
      currentPercent: row['percent'] as number,
      currentStatus: row['status'] as ProgressStatus,
    });
  }

  return {
    ...computeEvm(tasks, outside),
    baselineId: chosen.id,
    baselineLabel: chosen.label,
    statusDate,
  };
}
