/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';

/** S1 — một dòng của cây WBS (§10.4 danh sách cột). */
export interface WbsRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly childSequencing: string | null;
  readonly pic: string | null;
  readonly status: string;
  readonly percent: number;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly totalFloat: number | null;
  readonly isCritical: boolean;
  readonly delayReason: string | null;
}

export function loadWbsTree(db: Db, projectId: string): WbsRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md, t.role,
              t.child_sequencing,
              r.name AS pic,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              s.start_date, s.end_date, s.total_float, s.is_critical, s.delay_reason
       FROM task t
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource r   ON r.id = a.resource_id
       WHERE t.project_id = ?
       ORDER BY t.wbs_code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    depth: r['depth'] as number,
    parentUid: (r['parent_uid'] as string | null) ?? null,
    name: r['name'] as string,
    kind: r['kind'] as string,
    effortMd: (r['effort_md'] as number | null) ?? null,
    role: (r['role'] as string | null) ?? null,
    childSequencing: (r['child_sequencing'] as string | null) ?? null,
    pic: (r['pic'] as string | null) ?? null,
    status: r['status'] as string,
    percent: r['percent'] as number,
    planStart: (r['start_date'] as string | null) ?? null,
    planEnd: (r['end_date'] as string | null) ?? null,
    totalFloat: (r['total_float'] as number | null) ?? null,
    isCritical: r['is_critical'] === 1,
    delayReason: (r['delay_reason'] as string | null) ?? null,
  }));
}

/** S4 — dòng nhập tiến độ, kèm team để lead chỉ thấy team mình (§10.5, §10.6). */
export interface ProgressRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly effortMd: number | null;
  readonly status: string;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly teamId: string | null;
}

export function loadProgressRows(db: Db, projectId: string, teamId: string | null): ProgressRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, t.effort_md,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              p.actual_start, p.actual_end,
              s.start_date, s.end_date,
              rt.team_id
       FROM task t
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.project_id = ? AND t.kind != 'summary'
         AND (? IS NULL OR rt.team_id = ?)
       ORDER BY t.wbs_code`,
    )
    .all(projectId, teamId, teamId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    effortMd: (r['effort_md'] as number | null) ?? null,
    status: r['status'] as string,
    percent: r['percent'] as number,
    actualStart: (r['actual_start'] as string | null) ?? null,
    actualEnd: (r['actual_end'] as string | null) ?? null,
    planStart: (r['start_date'] as string | null) ?? null,
    planEnd: (r['end_date'] as string | null) ?? null,
    teamId: (r['team_id'] as string | null) ?? null,
  }));
}

/** Team của một task, để kiểm quyền lead trước khi cho ghi (§10.6). */
export function teamOfTask(db: Db, taskUid: string): string | null {
  const r = db
    .prepare(
      `SELECT rt.team_id
       FROM task t
       JOIN assignment a ON a.task_uid = t.uid
       JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.uid = ?`,
    )
    .get(taskUid) as { team_id: string } | undefined;
  return r?.team_id ?? null;
}

export function projectOfTask(db: Db, taskUid: string): string | undefined {
  const r = db.prepare('SELECT project_id FROM task WHERE uid = ?').get(taskUid) as
    { project_id: string } | undefined;
  return r?.project_id;
}

/** S6 — danh sách issue của lần validate mới nhất. */
export interface IssueRow {
  readonly severity: string;
  readonly code: string;
  readonly taskUid: string | null;
  readonly message: string;
  readonly detectedAt: string;
}

export function loadIssues(db: Db, projectId: string): IssueRow[] {
  const rows = db
    .prepare(
      `SELECT severity, code, task_uid, message, detected_at
       FROM validation_issue
       WHERE project_id = ? AND run_id = (
         SELECT run_id FROM validation_issue WHERE project_id = ?
         ORDER BY detected_at DESC, id DESC LIMIT 1
       )
       ORDER BY severity, code, task_uid`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    severity: r['severity'] as string,
    code: r['code'] as string,
    taskUid: (r['task_uid'] as string | null) ?? null,
    message: r['message'] as string,
    detectedAt: r['detected_at'] as string,
  }));
}

export interface TaskEditableFields {
  readonly name: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly priority: number;
}

export function loadTaskForEdit(db: Db, taskUid: string): TaskEditableFields | undefined {
  const r = db
    .prepare('SELECT name, effort_md, role, priority FROM task WHERE uid = ?')
    .get(taskUid) as
    { name: string; effort_md: number | null; role: string | null; priority: number } | undefined;
  if (r === undefined) return undefined;
  return { name: r.name, effortMd: r.effort_md, role: r.role, priority: r.priority };
}

export function updateTaskFields(
  db: Db,
  taskUid: string,
  fields: TaskEditableFields,
  now: string,
): void {
  db.prepare(
    'UPDATE task SET name = ?, effort_md = ?, role = ?, priority = ?, updated_at = ? WHERE uid = ?',
  ).run(fields.name, fields.effortMd, fields.role, fields.priority, now, taskUid);
}

export function upsertProgress(
  db: Db,
  p: {
    taskUid: string;
    status: string;
    percent: number;
    actualStart: string | null;
    actualEnd: string | null;
    updatedBy: string;
    source: 'ui' | 'api' | 'mcp';
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO progress (task_uid, status, percent, actual_start, actual_end, updated_by, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_uid) DO UPDATE SET
       status = excluded.status, percent = excluded.percent,
       actual_start = excluded.actual_start, actual_end = excluded.actual_end,
       updated_by = excluded.updated_by, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(p.taskUid, p.status, p.percent, p.actualStart, p.actualEnd, p.updatedBy, p.source, p.now);
}
