import type { Db } from '../src/db/migrate.js';
import type { ImportResult } from '../src/io/importer.js';

export const AT = '2026-09-13T00:00:00.000Z';
export const FIXTURE_SIZES = [20, 500, 6000] as const;

/** Dựng dự án + pool nhân sự phủ hết role fixture dùng (nếu thiếu sẽ dính C05). */
export function seedProject(db: Db, roles: readonly string[]): void {
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P-UTG','UTG','UTG',1,'2026-01-01','2026-01-01','CAL-VN','VN',?)`,
  ).run(AT);

  const insRes = db.prepare('INSERT INTO resource (id,name,location_id) VALUES (?,?,?)');
  const insRole = db.prepare('INSERT INTO resource_role (resource_id,role) VALUES (?,?)');
  roles.forEach((role, i) => {
    const id = `R-${String(i + 1).padStart(2, '0')}`;
    insRes.run(id, `Member ${i + 1}`, 'VN');
    insRole.run(id, role);
  });
}

/**
 * Ảnh chụp tất định của kết quả import.
 *
 * Sắp theo uid và serialize với indent cố định: so sánh byte-for-byte chỉ có nghĩa
 * khi chuỗi sinh ra không phụ thuộc thứ tự SQLite trả dòng.
 */
export function buildSnapshot(db: Db, result: ImportResult): string {
  const tasks = db
    .prepare(
      `SELECT uid, wbs_code, depth, parent_uid, sort_order, name, kind, effort_md, role,
              category, phase, module, priority, child_sequencing
       FROM task ORDER BY uid`,
    )
    .all();

  const dependencies = db
    .prepare(
      'SELECT pred_uid, succ_uid, type, lag_days FROM dependency ORDER BY pred_uid, succ_uid, type',
    )
    .all();

  return `${JSON.stringify(
    {
      tasksAdded: result.tasksAdded,
      mapping: result.mapping,
      report: result.report,
      tasks,
      dependencies,
    },
    null,
    2,
  )}\n`;
}
