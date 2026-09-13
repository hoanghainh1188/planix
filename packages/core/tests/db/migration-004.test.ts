/**
 * Migration 004 thêm bảng `validation_run`.
 *
 * Thêm bảng mới là loại migration lành nhất, nhưng vẫn phải chứng minh hai điều trên một
 * DB ĐANG CÓ dữ liệu: nó chạy được, và nó không đụng vào thứ gì sẵn có.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { loadLastValidationRun, recordValidationRun } from '../../src/db/repo/issue-repo.js';

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
  dir = mkdtempSync(join(tmpdir(), 'planix-mig4-'));
  db = openDatabase(join(dir, 'app.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('004 — bảng validation_run', () => {
  it('chạy được trên DB đã có dữ liệu, không mất gì', () => {
    migrate(db, AT);
    seed();
    const before = {
      tasks: db.prepare('SELECT COUNT(*) n FROM task').get(),
      deps: db.prepare('SELECT COUNT(*) n FROM dependency').get(),
    };

    db.prepare(`DELETE FROM schema_migrations WHERE name = '004_validation_run.sql'`).run();
    db.prepare('DROP TABLE validation_run').run();
    migrate(db, AT);

    expect(db.prepare('SELECT COUNT(*) n FROM task').get()).toEqual(before.tasks);
    expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual(before.deps);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('dự án chưa từng được đụng tới thì chưa có lượt nào', () => {
    migrate(db, AT);
    seed();
    // `seed()` có import, mà import LÀ một lượt validate (§8) — nên 'P' đã có dấu.
    // Một dự án khác, chưa ai nạp gì vào, thì phải còn trắng.
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('Q','GEO','GEO',2,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(AT);
    expect(loadLastValidationRun(db, 'Q')).toBeNull();
  });

  it('import đã đóng dấu một lượt — đó chính là §8 "sau mỗi lần import"', () => {
    migrate(db, AT);
    seed();
    const run = loadLastValidationRun(db, 'P');
    expect(run).not.toBeNull();
    expect(run).toMatchObject({ runId: 'I', ranAt: AT, critical: 0 });
  });

  it('dùng được ngay sau khi migrate', () => {
    migrate(db, AT);
    seed();
    recordValidationRun(db, { runId: 'r1', projectId: 'P', detectedAt: AT, issues: [] });
    expect(loadLastValidationRun(db, 'P')).toMatchObject({ runId: 'r1', critical: 0 });
  });

  it('một dự án chỉ giữ được đúng một dòng (PRIMARY KEY)', () => {
    migrate(db, AT);
    seed();
    expect(() =>
      db
        .prepare(`INSERT INTO validation_run (project_id,run_id,ran_at) VALUES ('P','r2',?)`)
        .run(AT),
    ).toThrow();
    expect(db.prepare(`SELECT COUNT(*) n FROM validation_run WHERE project_id='P'`).get()).toEqual({
      n: 1,
    });
  });
});
