/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';
import { rollupTree, type RollupTask } from '../../domain/rollup.js';
import type { ProgressStatus, TaskKind } from '../../domain/validation-types.js';

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
  /** §10.4 "ô có issue: chấm đỏ góc phải" — mã issue của ĐÚNG run mới nhất. */
  readonly issueCodes: readonly string[];
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

  // Một truy vấn gộp sẵn, KHÔNG phải mỗi dòng một lần (CLAUDE.md §8 cấm N+1). Cũng
  // không JOIN vào câu trên: một task nhiều issue sẽ nhân đôi dòng của cây.
  const issueCodes = new Map<string, string[]>();
  const issueRows = db
    .prepare(
      `SELECT task_uid, code
       FROM validation_issue
       WHERE project_id = ? AND task_uid IS NOT NULL AND run_id = (
         SELECT run_id FROM validation_issue WHERE project_id = ?
         ORDER BY detected_at DESC, id DESC LIMIT 1
       )
       ORDER BY code`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
  for (const r of issueRows) {
    const uid = r['task_uid'] as string;
    const list = issueCodes.get(uid);
    if (list === undefined) issueCodes.set(uid, [r['code'] as string]);
    else list.push(r['code'] as string);
  }

  // §7.7: summary KHÔNG có dữ liệu riêng — ngày, effort, status, % đều tính từ con
  // "lúc đọc", không lưu xuống. Bỏ bước này thì mọi dòng summary hiện ra rỗng trơn.
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

  return rows.map((r) => {
    const uid = r['uid'] as string;
    const kind = r['kind'] as string;
    const rolled = rollup.get(uid);
    const isSummary = kind === 'summary';

    return {
      uid,
      wbsCode: r['wbs_code'] as string,
      depth: r['depth'] as number,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      name: r['name'] as string,
      kind,
      // Summary hiện tổng MD của con; §7.7 cấm ghi số đó vào `task.effort_md`.
      effortMd: isSummary
        ? (rolled?.effortRollup ?? null)
        : ((r['effort_md'] as number | null) ?? null),
      role: (r['role'] as string | null) ?? null,
      childSequencing: (r['child_sequencing'] as string | null) ?? null,
      pic: (r['pic'] as string | null) ?? null,
      status: rolled?.status ?? (r['status'] as string),
      percent: rolled?.percentDisplay ?? (r['percent'] as number),
      planStart: rolled?.planStart ?? null,
      planEnd: rolled?.planEnd ?? null,
      // Float và đường găng chỉ có nghĩa trên task thật: CPM chạy trên lá, không trên
      // summary. Bịa một con số ở đây sẽ thành "đường găng" sai trên màn hình.
      totalFloat: isSummary ? null : ((r['total_float'] as number | null) ?? null),
      isCritical: !isSummary && r['is_critical'] === 1,
      delayReason: isSummary ? null : ((r['delay_reason'] as string | null) ?? null),
      issueCodes: issueCodes.get(uid) ?? [],
    };
  });
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
  // Cột `severity` đã có CHECK ba giá trị trong §4.2, nên kiểu ở đây phản ánh đúng thế.
  // Khai `string` là ném việc thu hẹp kiểu sang mọi nơi gọi.
  readonly severity: 'Critical' | 'Major' | 'Minor';
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
    severity: r['severity'] as IssueRow['severity'],
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
