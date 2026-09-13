/**
 * Truy vấn phục vụ import. Mọi SQL của engine nằm trong `db/repo/` (CLAUDE.md §3);
 * prepared statement, không nối chuỗi.
 */

import type { Db } from '../migrate.js';
import type {
  DependencyRow,
  ProgressRow,
  ResourceRoleRow,
  ResourceRow,
  TaskRow,
} from '../../domain/validation-types.js';

export interface ProjectRow {
  readonly id: string;
  readonly code: string;
  readonly dependencyMaxLevel: number;
}

export function findProjectByCode(db: Db, code: string): ProjectRow | undefined {
  const row = db
    .prepare('SELECT id, code, dependency_max_level FROM project WHERE code = ?')
    .get(code) as { id: string; code: string; dependency_max_level: number } | undefined;
  if (row === undefined) return undefined;
  return { id: row.id, code: row.code, dependencyMaxLevel: row.dependency_max_level };
}

/**
 * Số lớn nhất đã dùng trong uid dạng `T-NNNN`.
 *
 * Quét toàn bảng chứ không theo dự án: `task.uid` là khoá chính toàn cục, hai dự án
 * không được phép trùng uid.
 */
export function maxTaskSequence(db: Db): number {
  const rows = db.prepare("SELECT uid FROM task WHERE uid LIKE 'T-%'").all() as Array<{
    uid: string;
  }>;
  let max = 0;
  for (const { uid } of rows) {
    const n = Number.parseInt(uid.slice(2), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export function taskExists(db: Db, uid: string): boolean {
  return db.prepare('SELECT 1 FROM task WHERE uid = ?').get(uid) !== undefined;
}

/** Xoá toàn bộ con cháu của `rootUid`, KHÔNG xoá chính nó (§9.5). */
export function deleteSubtree(db: Db, rootUid: string): number {
  const info = db
    .prepare(
      `WITH RECURSIVE descendants(uid) AS (
         SELECT uid FROM task WHERE parent_uid = ?
         UNION ALL
         SELECT t.uid FROM task t JOIN descendants d ON t.parent_uid = d.uid
       )
       DELETE FROM task WHERE uid IN (SELECT uid FROM descendants)`,
    )
    .run(rootUid);
  return info.changes;
}

export interface InsertTaskParams {
  readonly uid: string;
  readonly projectId: string;
  readonly parentUid: string | null;
  readonly sortOrder: number;
  readonly name: string;
  readonly kind: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly category: string | null;
  readonly phase: string | null;
  readonly module: string | null;
  readonly priority: number;
  readonly childSequencing: string | null;
  readonly now: string;
}

export function insertTask(db: Db, p: InsertTaskParams): void {
  db.prepare(
    `INSERT INTO task
       (uid, project_id, wbs_code, depth, parent_uid, sort_order, name, kind,
        effort_md, role, category, phase, module, priority, child_sequencing,
        created_at, updated_at)
     VALUES (?, ?, '', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.uid,
    p.projectId,
    p.parentUid,
    p.sortOrder,
    p.name,
    p.kind,
    p.effortMd,
    p.role,
    p.category,
    p.phase,
    p.module,
    p.priority,
    p.childSequencing,
    p.now,
    p.now,
  );
}

export function insertDependency(
  db: Db,
  predUid: string,
  succUid: string,
  type: string,
  lagDays: number,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO dependency (pred_uid, succ_uid, type, lag_days) VALUES (?, ?, ?, ?)',
  ).run(predUid, succUid, type, lagDays);
}

export function updateWbs(db: Db, uid: string, wbsCode: string, depth: number): void {
  db.prepare('UPDATE task SET wbs_code = ?, depth = ? WHERE uid = ?').run(wbsCode, depth, uid);
}

// ── đọc lại để validate ─────────────────────────────────────────────────────

export function loadTasks(db: Db, projectId: string): TaskRow[] {
  const rows = db
    .prepare(
      `SELECT uid, project_id, wbs_code, depth, parent_uid, sort_order, name, kind,
              effort_md, role, constraint_type, constraint_date, child_sequencing
       FROM task WHERE project_id = ? ORDER BY uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    uid: r['uid'] as string,
    projectId: r['project_id'] as string,
    wbsCode: r['wbs_code'] as string,
    depth: r['depth'] as number,
    parentUid: (r['parent_uid'] as string | null) ?? null,
    sortOrder: r['sort_order'] as number,
    name: r['name'] as string,
    kind: r['kind'] as TaskRow['kind'],
    effortMd: (r['effort_md'] as number | null) ?? null,
    role: (r['role'] as string | null) ?? null,
    constraintType: (r['constraint_type'] as TaskRow['constraintType']) ?? null,
    constraintDate: (r['constraint_date'] as string | null) ?? null,
    childSequencing: (r['child_sequencing'] as 'parallel' | 'sequential' | null) ?? null,
  }));
}

export function loadDependencies(db: Db, projectId: string): DependencyRow[] {
  const rows = db
    .prepare(
      `SELECT d.pred_uid, d.succ_uid, d.type, d.lag_days
       FROM dependency d JOIN task t ON t.uid = d.succ_uid
       WHERE t.project_id = ? ORDER BY d.pred_uid, d.succ_uid, d.type`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    predUid: r['pred_uid'] as string,
    succUid: r['succ_uid'] as string,
    type: r['type'] as DependencyRow['type'],
    lagDays: r['lag_days'] as number,
  }));
}

/** Pool nhân sự TOÀN CỤC — không lọc theo dự án (§7.12). */
export function loadResources(db: Db): ResourceRow[] {
  const rows = db.prepare('SELECT id, name, location_id FROM resource ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: r['id'] as string,
    name: r['name'] as string,
    locationId: (r['location_id'] as string | null) ?? null,
  }));
}

export function loadResourceRoles(db: Db): ResourceRoleRow[] {
  const rows = db
    .prepare('SELECT resource_id, role FROM resource_role ORDER BY resource_id, role')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    role: r['role'] as string,
  }));
}

export function loadProgress(db: Db, projectId: string): ProgressRow[] {
  const rows = db
    .prepare(
      `SELECT p.task_uid, p.status, p.percent, p.actual_start, p.actual_end
       FROM progress p JOIN task t ON t.uid = p.task_uid
       WHERE t.project_id = ? ORDER BY p.task_uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    taskUid: r['task_uid'] as string,
    status: r['status'] as ProgressRow['status'],
    percent: r['percent'] as number,
    actualStart: (r['actual_start'] as string | null) ?? null,
    actualEnd: (r['actual_end'] as string | null) ?? null,
  }));
}
