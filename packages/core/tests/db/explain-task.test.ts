/**
 * `explainTask` — §7.6 viết cho người đọc.
 *
 * Chuỗi chặn đã có từ P13 và MCP dùng nó. Cái bài này canh là `refLabel`: `ref` là khoá
 * (`R-1`, `P-HI`, `T-0001`), đúng cho máy nhưng "chờ R-1" không trả lời được câu hỏi nào
 * của PM hay của khách.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleAllProjects } from '../../src/pipeline/schedule-project.js';
import { explainTask } from '../../src/db/repo/mcp-repo.js';

const AT = '2026-09-14T00:00:00.000Z';
let db: Db;

function addProject(id: string, code: string, priority: number): void {
  db.prepare(
    `INSERT INTO project (id,code,name,priority,status,start_date,status_date,calendar_id,default_location,created_at)
     VALUES (?,?,?,?,'active','2026-01-05','2026-01-05','CAL','VN',?)`,
  ).run(id, code, code, priority, AT);
}

/** Chuỗi `sequential` gồm `count` task Dev — task sau chờ task trước. */
function fill(code: string, count: number): void {
  importTasks(
    db,
    {
      version: '1.0',
      project_code: code,
      mode: 'merge',
      tasks: [
        {
          tmp_id: 'root',
          parent_tmp_id: null,
          name: `${code} root`,
          kind: 'summary',
          child_sequencing: 'sequential',
        },
        ...Array.from({ length: count }, (_, i) => ({
          tmp_id: `t${String(i)}`,
          parent_tmp_id: 'root',
          name: `${code} task ${String(i)}`,
          kind: 'work' as const,
          effort_md: 5,
          role: 'Dev',
        })),
      ],
      dependencies: [],
    },
    { runId: 'IMP', now: AT },
  );
}

function uidsOf(projectId: string): string[] {
  return (
    db
      .prepare(`SELECT uid FROM task WHERE project_id = ? AND kind = 'work' ORDER BY sort_order`)
      .all(projectId) as Array<{ uid: string }>
  ).map((r) => r.uid);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  // MỘT người — để dự án ưu tiên thấp chắc chắn bị dự án kia chiếm chỗ.
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Pham D','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();

  addProject('P-HI', 'HI', 1);
  addProject('P-LO', 'LO', 2);
  fill('HI', 3);
  fill('LO', 3);
  scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
});
afterEach(() => db.close());

describe('explainTask — refLabel', () => {
  it('bị dự án khác chiếm chỗ → nhãn là MÃ dự án, không phải id', () => {
    const reasons = uidsOf('P-LO').map((uid) => explainTask(db, uid).chain);
    const held = reasons.flat().find((l) => l.reason === 'cross_project');

    expect(held, 'fixture phải sinh ra ít nhất một cross_project').toBeDefined();
    expect(held?.ref).toBe('P-HI');
    expect(held?.refLabel).toBe('HI');
  });

  it('chờ task đứng trước → nhãn là mã WBS của task đó', () => {
    const [, second] = uidsOf('P-HI');
    const link = explainTask(db, second ?? '').chain[0];

    expect(link?.reason).toBe('dependency');
    const wbs = (
      db.prepare('SELECT wbs_code FROM task WHERE uid = ?').get(link?.ref) as {
        wbs_code: string;
      }
    ).wbs_code;
    expect(link?.refLabel).toBe(wbs);
  });

  it('ref trỏ tới thứ đã không còn → nhãn null, không ném', () => {
    const [first] = uidsOf('P-LO');
    db.prepare(
      `UPDATE schedule SET delay_reason = 'resource', blocking_ref = 'R-GONE' WHERE task_uid = ?`,
    ).run(first);

    const link = explainTask(db, first ?? '').chain[0];
    expect(link?.ref).toBe('R-GONE');
    expect(link?.refLabel).toBeNull();
  });

  it('resource → nhãn là TÊN người', () => {
    const [first] = uidsOf('P-LO');
    db.prepare(
      `UPDATE schedule SET delay_reason = 'resource', blocking_ref = 'R-1' WHERE task_uid = ?`,
    ).run(first);

    expect(explainTask(db, first ?? '').chain[0]?.refLabel).toBe('Pham D');
  });
});
