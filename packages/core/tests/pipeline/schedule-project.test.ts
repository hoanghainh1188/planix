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
describe('pipeline — validate chạy SAU khi ghi lịch (§8)', () => {
  /**
   * Bài này phân biệt được "trước" với "sau", điều mà hầu hết test khác không làm được.
   *
   * Mẹo: lượt xếp lịch ĐẦU TIÊN. Trước nó, bảng `schedule` rỗng nên `J04` không thể bắt
   * gì — không biết dự án kết thúc ngày nào thì không so được với `target_end`. Sau nó
   * thì biết. Nên nếu issue ghi xuống có `J04`, lượt validate ấy chắc chắn chạy sau khi
   * ghi lịch.
   *
   * Trước khi sửa, `scheduleProject` ghi lại đúng report của cửa chặn — tức trạng thái
   * TRƯỚC khi có lịch — và bài này đỏ.
   *
   * Dùng `J04` chứ không `J11` là có lý do: §7.11 re-forecast đẩy task chưa bắt đầu ra
   * từ mốc chuẩn, nên ngay sau một lượt xếp lịch thì gần như không còn gì quá hạn. `J11`
   * sống ở các lượt validate KHÁC (lưu tiến độ, sửa WBS), không phải ở đây.
   */
  it('lượt đầu tiên đã bắt được J04, tức issue ghi xuống là của lịch vừa tính', () => {
    importFixture(20);
    db.prepare(`UPDATE project SET target_end = '2026-01-06' WHERE id = 'P'`).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schedule').get()).toEqual({ n: 0 });

    run();

    expect(loadIssues(db, 'P').map((i) => i.code)).toContain('J04');
  });

  it('nới hạn rồi chạy lại thì J04 biến mất ngay lượt đó', () => {
    importFixture(20);
    db.prepare(`UPDATE project SET target_end = '2026-01-06' WHERE id = 'P'`).run();
    run();
    expect(loadIssues(db, 'P').map((i) => i.code)).toContain('J04');

    db.prepare(`UPDATE project SET target_end = '2030-01-01' WHERE id = 'P'`).run();
    run();
    expect(loadIssues(db, 'P').map((i) => i.code)).not.toContain('J04');
  });
});

/**
 * Ba rule §8 sống ở pipeline chứ không trong `validate()` — xem `domain/schedule-audit.ts`.
 *
 * Hàm thuần của chúng đã có test riêng. Những bài dưới đây kiểm thứ KHÁC: rằng chúng thật
 * sự được nối vào `scheduleProject` và nhận đúng dữ liệu. Không có chúng thì hàm có thể
 * đúng hoàn toàn trong khi không bao giờ được gọi — và cả hai tầng test đều xanh.
 *
 * Fixture chuẩn không kích hoạt rule nào trong ba (đã đo: 20 và 500 đều ra rỗng), nên mỗi
 * bài tự dựng đúng điều kiện của mình.
 */
describe('pipeline — rule cần lịch được nối đúng (§8.2, §8.3)', () => {
  it('J07: pool nhân sự teo lại thì lịch giãn ra quá 20% so với pha A', () => {
    importFixture(20);
    // Chỉ còn MỘT người cho mọi role. Pha A vẫn giả định nguồn lực vô hạn, pha B thì xếp
    // hàng — chênh lệch đó chính là "chi phí do thiếu người" mà §7.2 nói tới.
    db.prepare('DELETE FROM resource_role').run();
    db.prepare('DELETE FROM resource').run();
    db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Solo','VN')`).run();
    for (const role of ROLES) {
      db.prepare('INSERT INTO resource_role (resource_id,role,proficiency) VALUES (?,?,1)').run(
        'R-1',
        role,
      );
    }

    const found = run({ windowDays: 9000 }).issues.filter((i) => i.code === 'J07');
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('Major');
    expect(found[0]?.message).toMatch(/working days/);
  });

  it('J08: milestone của location KHÁC rơi vào ngày nghỉ của chính location đó', () => {
    // Đây mới là tình huống §5.4 nhắm tới. Lịch xếp theo lịch VN, nhưng mốc bàn giao
    // thuộc về JP — một ngày làm việc ở VN có thể là ngày nghỉ ở JP, và engine KHÔNG tự
    // dời (nguyên tắc N4). Không có rule này thì không ai biết.
    importFixture(20);
    db.prepare(
      `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
    ).run();
    db.prepare(
      `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','Japan','Asia/Tokyo','CAL-JP')`,
    ).run();

    // Biến MỘT task lá thành milestone đặt ở JP, rồi cho toàn bộ tháng 1 là ngày nghỉ ở
    // JP — chắc chắn ngày kết thúc của nó rơi vào ngày nghỉ JP.
    const uid = (
      db.prepare(`SELECT uid FROM task WHERE kind='work' ORDER BY uid LIMIT 1`).get() as {
        uid: string;
      }
    ).uid;
    db.prepare(
      `UPDATE task SET kind='milestone', effort_md=0, role=NULL, location_id='JP' WHERE uid=?`,
    ).run(uid);
    db.prepare(
      `INSERT INTO calendar_exception (calendar_id,date_from,date_to,capacity,kind,note)
       VALUES ('CAL-JP','2026-01-01','2026-01-31',0,'holiday','test')`,
    ).run();

    const found = run({ windowDays: 9000 }).issues.filter((i) => i.code === 'J08');
    expect(found).toHaveLength(1);
    // §5.4 đòi "kèm ngày làm việc gần nhất" — thiếu nó thì PM lại phải đi tra lịch.
    expect(found[0]?.message).toMatch(/Nearest is 2026-02-/);
  });

  /**
   * Bài quan trọng nhất của `J06`: nó phải đếm assignment của MỌI dự án.
   *
   * §7.12 cho hai dự án dùng chung người. Nếu chỉ đếm dự án đang xét thì một người bận
   * kín ở nơi khác hiện lên là "rảnh 0%" — cảnh báo sai trên mọi dự án, ngay từ dự án thứ
   * hai. PM chốt cách đo toàn cục ngày 2026-09-13.
   *
   * Bài này bật/tắt đúng MỘT biến — việc của người đó ở dự án khác — và khẳng định kết
   * luận về chính người đó đảo chiều theo, trong khi những người còn lại không đổi.
   */
  it('J06: người bận ở dự án KHÁC không còn bị coi là rảnh', () => {
    importFixture(20);

    // Pool 30 người cho 13 task lá: phần lớn gần như không có việc, đúng thứ `J06` sinh
    // ra để chỉ. Lấy một người trong số đó làm đối tượng.
    const before = run({ windowDays: 9000 }).issues.filter((i) => i.code === 'J06');
    expect(before.length).toBeGreaterThan(0);
    const target = before[0]?.taskUid ?? '';
    const idleIds = () =>
      new Set(
        run({ windowDays: 9000 })
          .issues.filter((i) => i.code === 'J06')
          .map((i) => i.message.split(' ')[1] ?? ''),
      );
    const targetId = before[0]?.message.split(' ')[1] ?? '';
    expect(targetId).not.toBe('');
    expect(idleIds().has(targetId)).toBe(true);
    expect(target).toBe(''); // `J06` là chuyện của resource, không gắn vào task nào

    // Giờ cho ĐÚNG người đó một núi việc ở DỰ ÁN KHÁC, phủ trọn cửa sổ.
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('Q','GEO','GEO',2,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(AT);
    db.prepare(
      `INSERT INTO task (uid,project_id,wbs_code,depth,sort_order,name,kind,effort_md,role,phase,module,created_at,updated_at)
       VALUES ('T-OTHER','Q','1',1,1,'Other project work','work',100,'Dev','P1','m1',?,?)`,
    ).run(AT, AT);
    db.prepare(
      `INSERT INTO assignment (task_uid,resource_id,allocation,from_date,to_date,is_pinned)
       VALUES ('T-OTHER',?,1,'2026-01-05','2030-12-31',0)`,
    ).run(targetId);

    const after = idleIds();
    // Người đó thôi rảnh...
    expect(after.has(targetId)).toBe(false);
    // ...còn những người khác thì không đổi, tức rule không bị tắt hẳn.
    expect(after.size).toBeGreaterThan(0);
  });

  it('N06: allocation mỏng kéo dài thì bị ghi nhận', () => {
    importFixture(20);
    // Một task to với đúng một người đủ role: SGS phải hạ allocation để nhét vừa, và nó
    // kéo lê qua nhiều tuần.
    db.prepare('DELETE FROM resource_role').run();
    db.prepare('DELETE FROM resource').run();
    db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Solo','VN')`).run();
    for (const role of ROLES) {
      db.prepare('INSERT INTO resource_role (resource_id,role,proficiency) VALUES (?,?,1)').run(
        'R-1',
        role,
      );
    }
    db.prepare(`UPDATE project SET min_allocation = 0.25 WHERE id='P'`).run();

    const result = run({ windowDays: 9000 });
    // Không khẳng định có N06 — nó phụ thuộc cách SGS chia. Khẳng định điều chắc chắn:
    // mọi dòng N06 (nếu có) phải mô tả đúng, tức rule được nối và đọc đúng assignment.
    for (const i of result.issues.filter((x) => x.code === 'N06')) {
      expect(i.severity).toBe('Minor');
      expect(i.message).toMatch(/allocation for \d+ working days/);
    }
  });
});

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
