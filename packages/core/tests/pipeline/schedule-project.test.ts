import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { ScheduleBlockedError, scheduleProject } from '../../src/pipeline/schedule-project.js';
import { loadIssues } from '../../src/db/repo/read-repo.js';
import { ROLES } from '../fixtures/generate.js';

const AT = '2026-09-13T00:00:00.000Z';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

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

  // §1.5 thiết kế 15-30 người. Mỗi người giữ HAI role: `resource_role` là quan hệ
  // nhiều-nhiều (§4.2), và thực tế một người đảm nhiệm được vài việc.
  //
  // Chi tiết này không phải cho đẹp. Với mỗi người một role, fixture 6.000 task cần
  // TechLead 4.853 MD trong khi 6 người giữ role đó chỉ cho 3.858 MD — engine từ chối
  // xếp lịch, đúng như nó phải làm. Hai role mỗi người đưa mỗi role lên 12 người.
  const insRes = db.prepare('INSERT INTO resource (id,name,location_id) VALUES (?,?,?)');
  const insRole = db.prepare(
    'INSERT INTO resource_role (resource_id,role,proficiency) VALUES (?,?,?)',
  );
  for (let i = 0; i < 30; i++) {
    const id = `R-${String(i).padStart(2, '0')}`;
    insRes.run(id, `Member ${i}`, 'VN');
    insRole.run(id, ROLES[i % ROLES.length] ?? 'Dev', 1);
    insRole.run(id, ROLES[(i + 1) % ROLES.length] ?? 'Dev', 1.2);
  }
}

function importFixture(size: number): void {
  const payload: unknown = JSON.parse(readFileSync(join(FIXTURES, `wbs-${size}.json`), 'utf8'));
  importTasks(db, payload, { runId: 'IMP', now: AT });
}

function run(over = {}) {
  return scheduleProject(db, { projectId: 'P', runId: 'RUN', now: AT, ...over });
}

function scheduleRows(): Array<Record<string, unknown>> {
  return db
    .prepare(
      'SELECT task_uid, start_date, end_date, es, ls, is_critical FROM schedule ORDER BY task_uid',
    )
    .all() as Array<Record<string, unknown>>;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  seed();
});
afterEach(() => db.close());

describe('pipeline — chạy hết ba pha §7.1', () => {
  it('mọi task lá đều có dòng schedule và được gán người', () => {
    importFixture(500);
    const r = run();

    const leaves = db
      .prepare(`SELECT COUNT(*) AS n FROM task WHERE project_id='P' AND kind != 'summary'`)
      .get() as { n: number };

    expect(r.scheduledCount).toBe(leaves.n);
    // Moc thuan effort 0 khong gan nguoi, nen assignedCount nho hon mot chut.
    expect(r.assignedCount).toBeGreaterThan(0);
    expect(r.assignedCount).toBeLessThanOrEqual(leaves.n);
    expect(r.projectEnd).not.toBeNull();
  });

  it('ghi cả kết quả pha A lẫn pha B vào bảng schedule', () => {
    importFixture(20);
    run();
    const rows = scheduleRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row['es']).toBeTruthy(); // pha A
      expect(row['ls']).toBeTruthy();
      expect(row['start_date']).toBeTruthy(); // pha B
      expect(row['end_date']).toBeTruthy();
    }
  });

  it('có task nằm trên critical path', () => {
    importFixture(20);
    run();
    const critical = db
      .prepare('SELECT COUNT(*) AS n FROM schedule WHERE is_critical = 1')
      .get() as { n: number };
    expect(critical.n).toBeGreaterThan(0);
  });

  it('write lock dưới 200 ms (§3.1)', () => {
    importFixture(500);
    const r = run();
    console.info(`write lock 500 task: ${r.writeLockMs.toFixed(1)} ms`);
    expect(r.writeLockMs).toBeLessThan(200);
  });
});

describe('pipeline — xoá sạch và tính lại từ đầu (§4.3)', () => {
  it('chạy 2 lần cho ra DB y hệt, không nhân đôi dòng', () => {
    importFixture(500);
    run();
    const first = JSON.stringify(scheduleRows());
    const firstAsg = JSON.stringify(db.prepare('SELECT * FROM assignment ORDER BY task_uid').all());

    run();
    expect(JSON.stringify(scheduleRows())).toBe(first);
    expect(JSON.stringify(db.prepare('SELECT * FROM assignment ORDER BY task_uid').all())).toBe(
      firstAsg,
    );
  });

  it('task bị xoá khỏi cây thì dòng schedule cũ cũng biến mất', () => {
    importFixture(20);
    run();
    const before = scheduleRows().length;

    const victim = db
      .prepare(`SELECT uid FROM task WHERE kind='work' ORDER BY uid LIMIT 1`)
      .get() as { uid: string };
    db.prepare('DELETE FROM task WHERE uid = ?').run(victim.uid);

    run();
    expect(scheduleRows().length).toBe(before - 1);
    expect(scheduleRows().some((r) => r['task_uid'] === victim.uid)).toBe(false);
  });
});

describe('pipeline — re-forecast nối vào lịch (§7.11)', () => {
  it('task done giữ NGÀY THẬT, engine không tính lại', () => {
    importFixture(20);
    const target = db
      .prepare(`SELECT uid FROM task WHERE kind='work' ORDER BY uid LIMIT 1`)
      .get() as { uid: string };
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,actual_start,actual_end,updated_at)
       VALUES (?, 'done', 100, '2025-12-01', '2025-12-03', ?)`,
    ).run(target.uid, AT);

    run();
    const row = db
      .prepare('SELECT start_date, end_date FROM schedule WHERE task_uid = ?')
      .get(target.uid);
    expect(row).toEqual({ start_date: '2025-12-01', end_date: '2025-12-03' });
  });

  it('task cancelled bị loại khỏi lịch hoàn toàn', () => {
    importFixture(20);
    const target = db
      .prepare(`SELECT uid FROM task WHERE kind='work' ORDER BY uid LIMIT 1`)
      .get() as { uid: string };
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_at) VALUES (?, 'cancelled', 0, ?)`,
    ).run(target.uid, AT);

    run();
    expect(db.prepare('SELECT 1 FROM schedule WHERE task_uid = ?').get(target.uid)).toBeUndefined();
    expect(
      db.prepare('SELECT 1 FROM assignment WHERE task_uid = ?').get(target.uid),
    ).toBeUndefined();
  });

  it('task in_progress chỉ lập lịch cho phần còn lại, không sớm hơn status_date', () => {
    importFixture(20);
    const target = db
      .prepare(`SELECT uid FROM task WHERE kind='work' ORDER BY uid LIMIT 1`)
      .get() as { uid: string };
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,actual_start,updated_at)
       VALUES (?, 'in_progress', 50, '2025-12-01', ?)`,
    ).run(target.uid, AT);

    run();
    const row = db
      .prepare('SELECT start_date FROM schedule WHERE task_uid = ?')
      .get(target.uid) as { start_date: string };
    expect(row.start_date >= '2026-01-05').toBe(true);
  });
});

describe('pipeline — Critical thì chặn (§8.1)', () => {
  it('ném ScheduleBlockedError và KHÔNG ghi gì', () => {
    importFixture(20);
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    expect(() => run()).toThrow(ScheduleBlockedError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schedule').get()).toEqual({ n: 0 });
  });

  it('lịch cũ vẫn nguyên khi lần chạy mới bị chặn', () => {
    importFixture(20);
    run();
    const before = scheduleRows().length;
    expect(before).toBeGreaterThan(0);

    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    expect(() => run()).toThrow(ScheduleBlockedError);
    expect(scheduleRows().length).toBe(before);
  });

  /**
   * Ca quan trọng nhất của cả việc lưu issue.
   *
   * Bị chặn là đúng lúc PM CẦN biết vì sao nhất, mà đó cũng là lúc `scheduleProject`
   * ném ra giữa chừng. Nếu chỉ ghi issue ở đường thành công thì panel S6 trống trơn
   * đúng vào lúc dự án hỏng — tệ hơn cả không có panel, vì trống trông như "không sao".
   */
  it('bị chặn thì VẪN ghi issue xuống, đó là lúc PM cần đọc nhất', () => {
    importFixture(20);
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    expect(() => run()).toThrow(ScheduleBlockedError);

    const issues = loadIssues(db, 'P');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.code)).toContain('C04');
    expect(issues.every((i) => i.severity === 'Critical' || i.severity !== undefined)).toBe(true);
  });

  it('sửa xong rồi chạy lại thì issue cũ biến mất', () => {
    importFixture(20);
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    expect(() => run()).toThrow(ScheduleBlockedError);
    expect(loadIssues(db, 'P').length).toBeGreaterThan(0);

    db.prepare(`UPDATE task SET role = 'Dev' WHERE kind = 'work'`).run();
    run();
    expect(loadIssues(db, 'P').map((i) => i.code)).not.toContain('C04');
  });

  it('chạy trót lọt cũng ghi — issue mức Major/Minor của engine phải tới được màn S6', () => {
    importFixture(20);
    run();
    // Fixture 20 sạch nên có thể không còn issue nào; điều cần khẳng định là đường ghi
    // ĐÃ chạy, tức bảng phản ánh đúng lượt vừa rồi chứ không phải rác của lượt trước.
    db.prepare(
      `INSERT INTO validation_issue (run_id,project_id,severity,code,message,detected_at)
       VALUES ('rac','P','Critical','C99','rac cua luot truoc',?)`,
    ).run(AT);
    run();
    expect(loadIssues(db, 'P').map((i) => i.code)).not.toContain('C99');
  });
});

/**
 * Cửa sổ 3.000 ngày, không phải 400 như khung thời gian §1.5.
 *
 * Fixture tổng hợp có MỘT NỬA số task là micro (<= 0.5 MD). Với `max_parallel = 2`, một
 * người mỗi ngày nhận tối đa 2 task dù task nhỏ đến đâu, nên 12.552 MD trên 30 người
 * kéo dài ~1.140 ngày làm việc thay vì 418. Engine làm đúng §7.5; đây là đặc tính của
 * dữ liệu, không phải lỗi.
 *
 * Chi tiết và ba phương án cho PM: docs/decisions/2026-09-13-micro-task-capacity-waste.md
 *
 * Lịch kết thúc quanh 2037, tức dự án 11 năm. Đó là NỢ CỦA FIXTURE, không phải của
 * engine: `generate.ts` nối module này sang module kia trên toàn bộ 60 module bất kể
 * phase, tạo một chuỗi gần như tuyệt đối. Dự án thật chỉ chuỗi trong phạm vi phase.
 *
 * Chưa sửa generator vì làm thế sẽ đổi fixture golden, mà CLAUDE.md §4 bắt việc đó phải
 * là commit riêng có giải thích. Fixture dù sao cũng phải sinh lại ở P6 để bổ sung các
 * tình huống §4 còn thiếu (task huỷ giữa chuỗi, người làm nhiều dự án, lễ chồng nghỉ
 * phép) — gộp hai việc vào một lần.
 *
 * Ở đây cửa sổ 9.000 ngày chỉ để bài test chạy hết; nó không phải khuyến nghị cấu hình.
 */
describe('pipeline — quy mô thật 6.000 task (§1.5, §7.14)', () => {
  it('chạy hết ba pha dưới 10 giây và write lock dưới 200 ms', () => {
    importFixture(6000);

    const t0 = performance.now();
    const r = run({ windowDays: 9000 });
    const elapsed = performance.now() - t0;

    console.info(
      `pipeline 6000 task: ${elapsed.toFixed(0)} ms tong, write lock ${r.writeLockMs.toFixed(1)} ms, ` +
        `ket thuc ${r.projectEnd}`,
    );

    const leaves = db
      .prepare(`SELECT COUNT(*) AS n FROM task WHERE project_id='P' AND kind != 'summary'`)
      .get() as { n: number };
    expect(r.scheduledCount).toBe(leaves.n);
    expect(elapsed).toBeLessThan(10_000);
    expect(r.writeLockMs).toBeLessThan(200);
  });

  it('chạy 2 lần ở quy mô thật cho DB y hệt (M2)', () => {
    importFixture(6000);
    run({ windowDays: 9000 });
    const first = JSON.stringify(scheduleRows());
    run({ windowDays: 9000 });
    expect(JSON.stringify(scheduleRows())).toBe(first);
  });
});
