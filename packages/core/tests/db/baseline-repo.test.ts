import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { closePeriod, PeriodNotClosedError } from '../../src/db/repo/baseline-repo.js';
import { importTasks } from '../../src/io/importer.js';
import { unsafeDateOnly as d } from '../../src/domain/date-only.js';

const AT = '2026-09-13T00:00:00.000Z';

let db: Db;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P','UTG','UTG',1,'2026-01-01','2026-01-01','CAL','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES ('U-1','pm@x.com','PM','h',?)`,
  ).run(AT);
  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'a', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'b', parent_tmp_id: 'a', name: 'Work', kind: 'work', effort_md: 2, role: 'Dev' },
      ],
      dependencies: [],
    },
    { runId: 'R0', now: AT },
  );
});
afterEach(() => db.close());

const params = (over = {}) => ({
  projectId: 'P',
  statusDate: d('2026-05-11'),
  label: 'Plan v1.0',
  takenBy: 'U-1',
  takenAt: AT,
  runId: 'RUN-1',
  baselineId: 'B-1',
  ...over,
});

describe('closePeriod — ba việc trong một transaction (§7.13)', () => {
  it('đặt status_date, validate, ghi baseline', () => {
    const res = closePeriod(db, params());
    expect(res.baselineId).toBe('B-1');
    expect(res.report.passed).toBe(true);
    expect(res.taskCount).toBe(2);

    const project = db.prepare('SELECT status_date FROM project WHERE id = ?').get('P') as {
      status_date: string;
    };
    expect(project.status_date).toBe('2026-05-11');

    const baseline = db.prepare('SELECT label, snapshot_json FROM baseline').get() as {
      label: string;
      snapshot_json: string;
    };
    expect(baseline.label).toBe('Plan v1.0');
    expect(JSON.parse(baseline.snapshot_json)).toMatchObject({ statusDate: '2026-05-11' });
  });

  it('có Critical thì DỪNG và status_date quay lại như cũ', () => {
    // Bo role cua task work -> C04.
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    const before = (
      db.prepare('SELECT status_date FROM project WHERE id = ?').get('P') as { status_date: string }
    ).status_date;

    expect(() => closePeriod(db, params())).toThrow(PeriodNotClosedError);

    const after = (
      db.prepare('SELECT status_date FROM project WHERE id = ?').get('P') as { status_date: string }
    ).status_date;
    expect(after).toBe(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM baseline').get()).toEqual({ n: 0 });
  });

  it('chốt hai kỳ thì có hai baseline, cái đầu là mốc cam kết (§7.13)', () => {
    closePeriod(db, params());
    closePeriod(db, params({ baselineId: 'B-2', label: 'Plan v1.1', statusDate: d('2026-05-18') }));
    const rows = db.prepare('SELECT id, label FROM baseline ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'B-1', label: 'Plan v1.0' },
      { id: 'B-2', label: 'Plan v1.1' },
    ]);
  });

  it('baseline không xoá được, chỉ ẩn (§7.13)', () => {
    closePeriod(db, params());
    db.prepare('UPDATE baseline SET is_hidden = 1 WHERE id = ?').run('B-1');
    const row = db.prepare('SELECT is_hidden FROM baseline WHERE id = ?').get('B-1');
    expect(row).toEqual({ is_hidden: 1 });
  });

  it('dự án không tồn tại thì ném lỗi', () => {
    expect(() => closePeriod(db, params({ projectId: 'KHONG-CO' }))).toThrow(/KHONG-CO/);
  });
});
