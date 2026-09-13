/**
 * Close period và baseline — SPEC.md §7.13.
 *
 * Ba việc trong MỘT transaction:
 *   1. đặt `project.status_date` = ngày PM chọn
 *   2. chạy validate — có Critical thì DỪNG, không chốt
 *   3. ghi một dòng `baseline` với `snapshot_json` đầy đủ
 *
 * Ba việc này phải cùng transaction: chốt nửa vời để lại `status_date` mới mà không có
 * baseline tương ứng, và mọi báo cáo sau đó gắn với một mốc không tồn tại.
 */

import type { Db } from '../migrate.js';
import { buildBaselineSnapshot, type BaselineTask } from '../../domain/baseline.js';
import { validate } from '../../domain/validator.js';
import type { ValidationReport } from '../../domain/validation-types.js';
import type { DateOnly } from '../../domain/date-only.js';
import * as importRepo from './import-repo.js';

export class PeriodNotClosedError extends Error {
  readonly report: ValidationReport;
  constructor(report: ValidationReport) {
    const codes = [
      ...new Set(report.issues.filter((i) => i.severity === 'Critical').map((i) => i.code)),
    ].sort();
    super(`Cannot close period: ${codes.join(', ')}`);
    this.name = 'PeriodNotClosedError';
    this.report = report;
  }
}

/** Đọc task kèm lịch và tiến độ, đủ để dựng snapshot. */
export function loadBaselineTasks(db: Db, projectId: string): BaselineTask[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, t.effort_md,
              s.start_date, s.end_date,
              p.status, p.percent
       FROM task t
       LEFT JOIN schedule s ON s.task_uid = t.uid
       LEFT JOIN progress p ON p.task_uid = t.uid
       WHERE t.project_id = ?
       ORDER BY t.uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    effortMd: (r['effort_md'] as number | null) ?? 0,
    startDate: (r['start_date'] as DateOnly | null) ?? null,
    endDate: (r['end_date'] as DateOnly | null) ?? null,
    status: (r['status'] as BaselineTask['status'] | null) ?? 'not_started',
    percent: (r['percent'] as number | null) ?? 0,
  }));
}

export interface ClosePeriodParams {
  readonly projectId: string;
  readonly statusDate: DateOnly;
  readonly label: string;
  readonly takenBy: string;
  readonly takenAt: string;
  readonly runId: string;
  readonly baselineId: string;
}

export interface ClosePeriodResult {
  readonly baselineId: string;
  readonly report: ValidationReport;
  readonly taskCount: number;
}

export function closePeriod(db: Db, params: ClosePeriodParams): ClosePeriodResult {
  const project = db
    .prepare('SELECT id, dependency_max_level FROM project WHERE id = ?')
    .get(params.projectId) as { id: string; dependency_max_level: number } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${params.projectId}`);

  return db.transaction((): ClosePeriodResult => {
    // 1 — đặt status_date trước khi validate, để rule nào phụ thuộc mốc này (J11 quá
    // hạn chẳng hạn) được đánh giá theo đúng kỳ đang chốt.
    db.prepare('UPDATE project SET status_date = ? WHERE id = ?').run(
      params.statusDate,
      params.projectId,
    );

    // 2 — validate. Có Critical thì ném; transaction rollback nên status_date cũng
    // quay lại như cũ, không để DB ở trạng thái nửa chốt.
    const report = validate({
      runId: params.runId,
      projectId: params.projectId,
      tasks: importRepo.loadTasks(db, params.projectId),
      dependencies: importRepo.loadDependencies(db, params.projectId),
      resources: importRepo.loadResources(db),
      resourceRoles: importRepo.loadResourceRoles(db),
      progress: importRepo.loadProgress(db, params.projectId),
      dependencyMaxLevel: project.dependency_max_level,
    });
    if (!report.passed) throw new PeriodNotClosedError(report);

    // 3 — ghi baseline.
    const tasks = loadBaselineTasks(db, params.projectId);
    db.prepare(
      `INSERT INTO baseline (id, project_id, label, status_date, taken_by, taken_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.baselineId,
      params.projectId,
      params.label,
      params.statusDate,
      params.takenBy,
      params.takenAt,
      buildBaselineSnapshot(tasks, params.statusDate),
    );

    return { baselineId: params.baselineId, report, taskCount: tasks.length };
  })();
}
