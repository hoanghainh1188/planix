/**
 * Migration 003 dựng LẠI bảng `project` để đổi giá trị mặc định của `default_max_parallel`.
 *
 * Đây là migration nguy hiểm nhất từ trước tới nay: `DROP TABLE` khi foreign key đang bật
 * sẽ kích hoạt `ON DELETE CASCADE` và xoá sạch task, dependency, schedule. Test ở đây tồn
 * tại để khẳng định điều đó KHÔNG xảy ra.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';

const AT = '2026-09-13T00:00:00.000Z';
let dir: string;
let db: Db;

function seed(): void {
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
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 2, role: 'Dev' },
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'B', kind: 'work', effort_md: 1, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-mig3-'));
  db = openDatabase(join(dir, 'app.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('003 — nâng default_max_parallel lên 4', () => {
  it('dự án tạo MỚI nhận 4, không phải 2', () => {
    migrate(db, AT);
    seed();
    const r = db.prepare(`SELECT default_max_parallel AS n FROM project WHERE id='P'`).get() as {
      n: number;
    };
    expect(r.n).toBe(4);
  });

  it('KHÔNG mất task, dependency hay bất kỳ dữ liệu con nào', () => {
    // Chạy 001+002 trước, nạp dữ liệu, RỒI mới để 003 dựng lại bảng — đúng thứ tự mà một
    // DB đang chạy thật sẽ gặp.
    migrate(db, AT);
    seed();
    const before = {
      tasks: db.prepare('SELECT COUNT(*) n FROM task').get(),
      deps: db.prepare('SELECT COUNT(*) n FROM dependency').get(),
      projects: db.prepare('SELECT COUNT(*) n FROM project').get(),
    };
    expect((before.tasks as { n: number }).n).toBeGreaterThan(0);
    expect((before.deps as { n: number }).n).toBeGreaterThan(0);

    // Gỡ dấu đã chạy rồi chạy lại đúng migration đó.
    db.prepare(`DELETE FROM schema_migrations WHERE name = '003_max_parallel_default.sql'`).run();
    migrate(db, AT);

    expect(db.prepare('SELECT COUNT(*) n FROM task').get()).toEqual(before.tasks);
    expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual(before.deps);
    expect(db.prepare('SELECT COUNT(*) n FROM project').get()).toEqual(before.projects);
  });

  it('khoá ngoại vẫn nguyên vẹn sau khi dựng lại bảng', () => {
    migrate(db, AT);
    seed();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // Và ràng buộc vẫn còn hiệu lực: chèn task trỏ vào dự án không tồn tại phải hỏng.
    expect(() =>
      db
        .prepare(
          `INSERT INTO task (uid,project_id,wbs_code,depth,sort_order,name,kind,created_at,updated_at)
           VALUES ('T-X','KHONG-CO','9',1,1,'x','work',?,?)`,
        )
        .run(AT, AT),
    ).toThrow();
  });

  it('giữ nguyên mọi cột, kể cả `target_end` vốn không ai dùng tới', () => {
    migrate(db, AT);
    const cols = (db.prepare('PRAGMA table_info(project)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      'id',
      'code',
      'name',
      'priority',
      'status',
      'start_date',
      'target_end',
      'status_date',
      'calendar_id',
      'default_location',
      'default_max_parallel',
      'min_allocation',
      'dependency_max_level',
      'micro_task_threshold',
      'created_at',
    ]);
  });

  it('dự án đã chỉnh tay sang giá trị khác thì GIỮ NGUYÊN, không bị đè', () => {
    migrate(db, AT);
    seed();
    db.prepare(`UPDATE project SET default_max_parallel = 1 WHERE id='P'`).run();

    db.prepare(`DELETE FROM schema_migrations WHERE name = '003_max_parallel_default.sql'`).run();
    migrate(db, AT);

    const r = db.prepare(`SELECT default_max_parallel AS n FROM project WHERE id='P'`).get() as {
      n: number;
    };
    expect(r.n).toBe(1);
  });
});
