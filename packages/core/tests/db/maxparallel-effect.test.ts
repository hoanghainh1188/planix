/**
 * Đo tác dụng THẬT của việc nâng `default_max_parallel` từ 2 lên 4.
 *
 * PM quyết dựa trên con số "đốt năng lực gấp ~2,7 lần" trong
 * docs/decisions/2026-09-13-micro-task-capacity-waste.md. Golden test không đổi sau khi
 * nâng, nên phải kiểm bằng số: nếu tham số này không đổi được gì thì quyết định của PM
 * là vô hiệu, và điều đó phải lộ ra chứ không nằm im.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleProject } from '../../src/pipeline/schedule-project.js';
import { ROLES } from '../fixtures/generate.js';

const AT = '2026-09-13T00:00:00.000Z';
let dir: string;

/** WBS mịn: nhiều task nhỏ trên ít người — đúng hình dạng mà §7.9 cảnh báo. */
function build(maxParallel: number): { end: string | null; days: number } {
  const db: Db = openDatabase(join(dir, `mp${String(maxParallel)}.db`));
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,default_max_parallel,created_at)
     VALUES ('P','UTG','UTG',1,'2026-01-05','2026-01-05','CAL','VN',?,?)`,
  ).run(maxParallel, AT);

  for (let i = 0; i < 5; i++) {
    const id = `R-${String(i)}`;
    db.prepare('INSERT INTO resource (id,name,location_id) VALUES (?,?,?)').run(id, id, 'VN');
    for (const role of ROLES) {
      db.prepare('INSERT INTO resource_role (resource_id,role) VALUES (?,?)').run(id, role);
    }
  }

  // 200 micro task 0,25 MD, KHÔNG phụ thuộc nhau — chỉ năng lực người mới giới hạn.
  const tasks = [
    { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' as const },
    ...Array.from({ length: 200 }, (_, i) => ({
      tmp_id: `t${String(i)}`,
      parent_tmp_id: 'r',
      name: `T${String(i)}`,
      kind: 'work' as const,
      effort_md: 0.25,
      role: ROLES[i % ROLES.length] ?? 'Dev',
    })),
  ];
  importTasks(
    db,
    { version: '1.0', project_code: 'UTG', mode: 'merge', tasks, dependencies: [] },
    { runId: 'I', now: AT },
  );
  scheduleProject(db, { projectId: 'P', runId: 'S', now: AT });

  const r = db.prepare('SELECT MAX(end_date) e, COUNT(*) n FROM schedule').get() as {
    e: string | null;
    n: number;
  };
  const busiest = db
    .prepare(
      `SELECT from_date d, COUNT(*) n FROM assignment GROUP BY resource_id, from_date
       ORDER BY n DESC LIMIT 1`,
    )
    .get() as { d: string; n: number } | undefined;
  db.close();
  return { end: r.e, days: busiest?.n ?? 0 };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-mp-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('nâng max_parallel có tác dụng đo được', () => {
  it('4 xếp xong SỚM HƠN 2 trên WBS toàn micro task', () => {
    const two = build(2);
    const four = build(4);

    expect(two.end).not.toBeNull();
    expect(four.end).not.toBeNull();
    // Đây là điều PM mua khi chọn phương án A.
    expect(String(four.end) < String(two.end)).toBe(true);
  });

  it('số task một người chạy trong một ngày bị chặn ĐÚNG bằng max_parallel (§7.5)', () => {
    expect(build(2).days).toBeLessThanOrEqual(2);
    expect(build(4).days).toBeLessThanOrEqual(4);
  });

  it('mặc định của DB sau migration 003 đúng là 4', () => {
    const db = openDatabase(join(dir, 'default.db'));
    migrate(db, AT);
    db.prepare(
      `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
    ).run();
    db.prepare(
      `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
    ).run();
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('P','UTG','UTG',1,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(AT);
    const r = db.prepare('SELECT default_max_parallel AS n FROM project').get() as { n: number };
    db.close();
    expect(r.n).toBe(4);
  });
});
