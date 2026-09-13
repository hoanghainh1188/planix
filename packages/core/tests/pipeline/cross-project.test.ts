import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleAllProjects, scheduleProject } from '../../src/pipeline/schedule-project.js';
import { loadSchedulableProjects } from '../../src/db/repo/schedule-repo.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

function addProject(id: string, code: string, priority: number, status = 'active'): void {
  db.prepare(
    `INSERT INTO project (id,code,name,priority,status,start_date,status_date,calendar_id,default_location,created_at)
     VALUES (?,?,?,?,?,'2026-01-05','2026-01-05','CAL','VN',?)`,
  ).run(id, code, code, priority, status, AT);
}

/** Mỗi dự án một cây nhỏ, toàn task Dev — để hai dự án tranh đúng một người. */
function fill(code: string, count: number, effortMd = 5): void {
  const tasks = [
    { tmp_id: 'root', parent_tmp_id: null, name: `${code} root`, kind: 'summary' as const },
    ...Array.from({ length: count }, (_, i) => ({
      tmp_id: `t${i}`,
      parent_tmp_id: 'root',
      name: `${code} task ${i}`,
      kind: 'work' as const,
      effort_md: effortMd,
      role: 'Dev',
    })),
  ];
  importTasks(
    db,
    { version: '1.0', project_code: code, mode: 'merge', tasks, dependencies: [] },
    { runId: 'IMP', now: AT },
  );
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
  // MỘT người duy nhất — mọi tranh chấp đều rơi vào anh ta.
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev A','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
});
afterEach(() => db.close());

describe('thứ tự dự án (§7.12)', () => {
  it('sắp theo priority tăng dần', () => {
    addProject('P-B', 'BBB', 2);
    addProject('P-A', 'AAA', 1);
    expect(loadSchedulableProjects(db).map((p) => p.code)).toEqual(['AAA', 'BBB']);
  });

  it('trùng priority thì tie-break theo code tăng dần', () => {
    addProject('P-Z', 'ZZZ', 1);
    addProject('P-A', 'AAA', 1);
    expect(loadSchedulableProjects(db).map((p) => p.code)).toEqual(['AAA', 'ZZZ']);
  });

  it('bỏ qua dự án onhold và closed', () => {
    addProject('P-1', 'ACT', 1);
    addProject('P-2', 'HLD', 1, 'onhold');
    addProject('P-3', 'CLS', 1, 'closed');
    expect(loadSchedulableProjects(db).map((p) => p.code)).toEqual(['ACT']);
  });
});

describe('hai dự án dùng chung người (§14.2 P6)', () => {
  beforeEach(() => {
    addProject('P-HI', 'HI', 1);
    addProject('P-LO', 'LO', 2);
    fill('HI', 4);
    fill('LO', 4);
  });

  it('KHÔNG ai vượt 100% capacity — không có ngày nào tổng allocation > 1', () => {
    scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });

    const rows = db
      .prepare('SELECT resource_id, from_date, to_date, allocation FROM assignment')
      .all() as Array<{
      resource_id: string;
      from_date: string;
      to_date: string;
      allocation: number;
    }>;

    // Cong don allocation theo tung ngay.
    const perDay = new Map<string, number>();
    for (const a of rows) {
      for (let d = new Date(a.from_date); d <= new Date(a.to_date); d.setDate(d.getDate() + 1)) {
        const key = `${a.resource_id}|${d.toISOString().slice(0, 10)}`;
        perDay.set(key, (perDay.get(key) ?? 0) + a.allocation);
      }
    }
    const over = [...perDay.entries()].filter(([, v]) => v > 1.0001);
    expect(over).toEqual([]);
  });

  it('dự án ưu tiên cao chạy trước và chiếm lịch sớm', () => {
    const r = scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
    expect(r.order).toEqual(['P-HI', 'P-LO']);

    const earliest = (projectId: string) =>
      (
        db
          .prepare(
            `SELECT MIN(s.start_date) AS m FROM schedule s JOIN task t ON t.uid = s.task_uid
             WHERE t.project_id = ?`,
          )
          .get(projectId) as { m: string }
      ).m;

    expect(earliest('P-HI') < earliest('P-LO')).toBe(true);
  });

  it('dự án ưu tiên thấp bị đẩy thì sinh J14 nêu ĐÚNG dự án chiếm chỗ', () => {
    const r = scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
    const lo = r.perProject.get('P-LO');
    const j14 = lo?.issues.filter((i) => i.code === 'J14') ?? [];

    expect(j14.length).toBeGreaterThan(0);
    expect(j14[0]?.severity).toBe('Major');
    expect(j14[0]?.message).toMatch(/P-HI/);
  });

  it('delay_reason ghi cross_project và blocking_ref là project_id', () => {
    scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
    const row = db
      .prepare(
        `SELECT s.delay_reason, s.blocking_ref FROM schedule s JOIN task t ON t.uid = s.task_uid
         WHERE t.project_id = 'P-LO' AND s.delay_reason = 'cross_project' LIMIT 1`,
      )
      .get() as { delay_reason: string; blocking_ref: string } | undefined;

    expect(row?.delay_reason).toBe('cross_project');
    expect(row?.blocking_ref).toBe('P-HI');
  });
});

describe('Recalculate this project KHÔNG đổi lịch dự án khác (§7.12)', () => {
  it('lịch dự án kia giữ nguyên từng byte', () => {
    addProject('P-HI', 'HI', 1);
    addProject('P-LO', 'LO', 2);
    fill('HI', 3);
    fill('LO', 3);
    scheduleAllProjects(db, { runId: 'R1', now: AT, windowDays: 400 });

    const snapshotOf = (projectId: string) =>
      JSON.stringify(
        db
          .prepare(
            `SELECT s.task_uid, s.start_date, s.end_date FROM schedule s JOIN task t ON t.uid = s.task_uid
             WHERE t.project_id = ? ORDER BY s.task_uid`,
          )
          .all(projectId),
      );

    const hiBefore = snapshotOf('P-HI');
    scheduleProject(db, { projectId: 'P-LO', runId: 'R2', now: AT, windowDays: 400 });
    expect(snapshotOf('P-HI')).toBe(hiBefore);
  });

  it('chạy lại một dự án vẫn tôn trọng chỗ đã bị dự án kia chiếm', () => {
    addProject('P-HI', 'HI', 1);
    addProject('P-LO', 'LO', 2);
    fill('HI', 4);
    fill('LO', 2);
    scheduleAllProjects(db, { runId: 'R1', now: AT, windowDays: 400 });

    const before = JSON.stringify(
      db
        .prepare(
          `SELECT s.start_date FROM schedule s JOIN task t ON t.uid = s.task_uid
           WHERE t.project_id = 'P-LO' ORDER BY s.task_uid`,
        )
        .all(),
    );
    scheduleProject(db, { projectId: 'P-LO', runId: 'R2', now: AT, windowDays: 400 });
    const after = JSON.stringify(
      db
        .prepare(
          `SELECT s.start_date FROM schedule s JOIN task t ON t.uid = s.task_uid
           WHERE t.project_id = 'P-LO' ORDER BY s.task_uid`,
        )
        .all(),
    );
    expect(after).toBe(before);
  });
});

describe('tái lập được ở quy mô đa dự án (M2)', () => {
  it('chạy Recalculate all hai lần cho DB y hệt', () => {
    addProject('P-A', 'AAA', 1);
    addProject('P-B', 'BBB', 2);
    fill('AAA', 3);
    fill('BBB', 3);

    scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
    const first = JSON.stringify(db.prepare('SELECT * FROM schedule ORDER BY task_uid').all());
    scheduleAllProjects(db, { runId: 'R', now: AT, windowDays: 400 });
    expect(JSON.stringify(db.prepare('SELECT * FROM schedule ORDER BY task_uid').all())).toBe(
      first,
    );
  });
});

describe('việc đang chạy không bị dời (§7.12)', () => {
  it('task in_progress giữ nguyên người làm qua các lần recalculate', () => {
    addProject('P-1', 'ONE', 1);
    db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-2','Dev B','VN')`).run();
    db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-2','Dev')`).run();
    fill('ONE', 4, 3);
    scheduleProject(db, { projectId: 'P-1', runId: 'R1', now: AT, windowDays: 400 });

    const first = db
      .prepare('SELECT task_uid, resource_id FROM assignment ORDER BY task_uid')
      .all() as Array<{ task_uid: string; resource_id: string }>;
    const running = first[0];
    expect(running).toBeDefined();

    // Danh dau task do la dang lam.
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,actual_start,updated_at)
       VALUES (?, 'in_progress', 40, '2026-01-05', ?)`,
    ).run(running!.task_uid, AT);

    scheduleProject(db, { projectId: 'P-1', runId: 'R2', now: AT, windowDays: 400 });

    const after = db
      .prepare('SELECT resource_id, is_pinned FROM assignment WHERE task_uid = ?')
      .get(running!.task_uid) as { resource_id: string; is_pinned: number };

    expect(after.resource_id).toBe(running!.resource_id);
    expect(after.is_pinned).toBe(1);
  });

  it('task chưa bắt đầu thì KHÔNG bị ghim, engine vẫn tự do chọn người', () => {
    addProject('P-1', 'ONE', 1);
    fill('ONE', 2, 2);
    scheduleProject(db, { projectId: 'P-1', runId: 'R1', now: AT, windowDays: 400 });
    const rows = db.prepare('SELECT is_pinned FROM assignment').all() as Array<{
      is_pinned: number;
    }>;
    expect(rows.every((r) => r.is_pinned === 0)).toBe(true);
  });
});
