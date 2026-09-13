import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/db/migrate.js';

/** Thời điểm cố định — migrate() nhận clock từ ngoài, không tự đọc (N2). */
const APPLIED_AT = '2026-09-13T00:00:00.000Z';

/** Mọi DB mở trong một test, để đóng hết sau khi test xong. */
const opened: Array<ReturnType<typeof openDatabase>> = [];

/** DB trong RAM — mỗi test một DB sạch, không đụng file thật. */
function freshDb() {
  const db = openDatabase(':memory:');
  opened.push(db);
  return db;
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
});

function tableNames(db: ReturnType<typeof freshDb>): string[] {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name)
    .filter((n) => !n.startsWith('sqlite_'));
}

describe('migrate — từ DB rỗng (§14.2 P1)', () => {
  it('tạo đủ 18 bảng của SPEC.md §4.2', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);

    const expected = [
      'app_user',
      'assignment',
      'audit_log',
      'baseline',
      'calendar',
      'calendar_exception',
      'dependency',
      'location',
      'progress',
      'project',
      'resource',
      'resource_role',
      'resource_team',
      'schedule',
      'task',
      'team',
      'user_project',
      'validation_issue',
    ];
    expect(tableNames(db)).toEqual(expect.arrayContaining(expected));
    expect(expected.length).toBe(18);
  });

  it('tạo đủ 7 index của §4.2', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`,
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(idx).toEqual([
      'idx_asg_res',
      'idx_audit',
      'idx_audit_user',
      'idx_cal_exc',
      'idx_task_depth',
      'idx_task_parent',
      'idx_task_wbs',
    ]);
  });

  it('chạy 2 lần không lỗi và không áp dụng lại migration đã chạy', () => {
    const db = freshDb();
    const first = migrate(db, APPLIED_AT);
    const second = migrate(db, APPLIED_AT);

    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);
    expect(tableNames(db).length).toBe(tableNames(db).length);
  });

  it('bật foreign_keys — nếu tắt thì mọi REFERENCES trong §4.2 chỉ là trang trí', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    const [row] = db.prepare('PRAGMA foreign_keys').all() as Array<{ foreign_keys: number }>;
    expect(row?.foreign_keys).toBe(1);
  });

  it('chặn FK sai: task trỏ tới project không tồn tại', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO task (uid, project_id, wbs_code, depth, sort_order, name, kind, created_at, updated_at)
           VALUES ('T-0001', 'KHONG-TON-TAI', '1', 1, 1, 'x', 'work', '2026-01-01', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('CHECK constraint của §4.2', () => {
  it('task.kind chỉ nhận summary | work | milestone', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    seedProject(db);
    expect(() => insertTask(db, 'T-0002', 'khong-hop-le')).toThrow(/CHECK/i);
    expect(() => insertTask(db, 'T-0003', 'work')).not.toThrow();
  });

  it('progress.percent phải nằm trong 0..100', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    seedProject(db);
    insertTask(db, 'T-0004', 'work');
    expect(() =>
      db
        .prepare(
          `INSERT INTO progress (task_uid, status, percent, updated_at)
           VALUES ('T-0004', 'in_progress', 150, '2026-01-01')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it('dependency.type chỉ nhận FS | SS | FF | SF', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    seedProject(db);
    insertTask(db, 'T-0005', 'work');
    insertTask(db, 'T-0006', 'work');
    expect(() =>
      db
        .prepare(
          `INSERT INTO dependency (pred_uid, succ_uid, type, lag_days) VALUES ('T-0005','T-0006','XX',0)`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });
});

describe('Trigger — resource_team phải cùng dự án (§4.2)', () => {
  it('chặn khi team thuộc dự án khác với resource_team.project_id', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    seedProject(db);
    seedProject(db, 'P-GEO', 'GEO');
    db.prepare(`INSERT INTO team (id, project_id, name) VALUES ('TM-1','P-UTG','BE')`).run();
    db.prepare(`INSERT INTO resource (id, name, location_id) VALUES ('R-1','Dev A','VN')`).run();

    // team TM-1 thuoc P-UTG, nhung dong nay khai project_id = P-GEO
    expect(() =>
      db
        .prepare(
          `INSERT INTO resource_team (resource_id, project_id, team_id) VALUES ('R-1','P-GEO','TM-1')`,
        )
        .run(),
    ).toThrow(/team/i);
  });

  it('cho phép khi cùng dự án', () => {
    const db = freshDb();
    migrate(db, APPLIED_AT);
    seedProject(db);
    db.prepare(`INSERT INTO team (id, project_id, name) VALUES ('TM-1','P-UTG','BE')`).run();
    db.prepare(`INSERT INTO resource (id, name, location_id) VALUES ('R-1','Dev A','VN')`).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO resource_team (resource_id, project_id, team_id) VALUES ('R-1','P-UTG','TM-1')`,
        )
        .run(),
    ).not.toThrow();
  });
});

// ── helper ───────────────────────────────────────────────────────────────────

function seedProject(db: ReturnType<typeof freshDb>, id = 'P-UTG', code = 'UTG'): void {
  db.prepare(
    `INSERT OR IGNORE INTO calendar (id, name, scope, week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO location (id, name, timezone, calendar_id)
     VALUES ('VN','Viet Nam','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id, code, name, priority, start_date, status_date, calendar_id, default_location, created_at)
     VALUES (?, ?, ?, 1, '2026-01-01', '2026-01-01', 'CAL-VN', 'VN', '2026-01-01')`,
  ).run(id, code, code);
}

function insertTask(
  db: ReturnType<typeof freshDb>,
  uid: string,
  kind: string,
  projectId = 'P-UTG',
): void {
  db.prepare(
    `INSERT INTO task (uid, project_id, wbs_code, depth, sort_order, name, kind, effort_md, role, created_at, updated_at)
     VALUES (?, ?, '1', 1, 1, 'task', ?, 1.0, 'Dev', '2026-01-01', '2026-01-01')`,
  ).run(uid, projectId, kind);
}
