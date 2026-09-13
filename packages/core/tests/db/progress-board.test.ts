/**
 * §10.5 là màn "quyết định tool sống hay chết": nếu đề xuất sai thì lead phải sửa gần hết
 * và màn hình mất ý nghĩa. Test ở đây bám đúng bảng đề xuất của spec, trên DB thật đã
 * chạy qua scheduler — không mock.
 */

import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { loadProgressBoard } from '../../src/db/repo/read-repo.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleProject } from '../../src/pipeline/schedule-project.js';

const AT = '2026-09-13T00:00:00.000Z';

/**
 * Dựng dự án và xếp lịch MỘT lần với `status_date` = ngày bắt đầu.
 *
 * Không truyền `status_date` khác vào đây được: §7.11 bắt task `not_started` không được
 * xếp sớm hơn `status_date`, nên đổi nó rồi xếp lại sẽ dời luôn cả kế hoạch và chẳng bao
 * giờ có task nào quá hạn. Luồng thật cũng vậy: kế hoạch chốt trước, mỗi tuần PM đẩy
 * `status_date` lên rồi lead nhập tiến độ so với kế hoạch CŨ — `setStatusDate` mô phỏng
 * đúng bước đó.
 */
function build(): Db {
  const statusDate = '2026-03-02';
  const db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,status_date,start_date,calendar_id,default_location,created_at)
     VALUES ('P','UTG','UTG',1,?,'2026-03-02','CAL','VN',?)`,
  ).run(statusDate, AT);
  db.prepare(`INSERT INTO team (id,project_id,name) VALUES ('TM','P','BE')`).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev A','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(
    `INSERT INTO resource_team (resource_id,project_id,team_id) VALUES ('R-1','P','TM')`,
  ).run();
  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES ('U','pm@x.com','PM','h',?)`,
  ).run(AT);

  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'S', parent_tmp_id: null, name: 'Phase', kind: 'summary' },
        // 5 ngày công, chạy 02/03 → 06/03.
        { tmp_id: 'big', parent_tmp_id: 'S', name: 'Big', kind: 'work', effort_md: 5, role: 'Dev' },
        // 0.25 MD → micro task (ngưỡng mặc định 0.5).
        {
          tmp_id: 'tiny',
          parent_tmp_id: 'S',
          name: 'Tiny',
          kind: 'work',
          effort_md: 0.25,
          role: 'Dev',
        },
      ],
      dependencies: [{ pred: 'big', succ: 'tiny', type: 'FS', lag_days: 0 }],
    },
    { runId: 'r1', now: AT },
  );
  scheduleProject(db, { projectId: 'P', runId: 'r2', now: AT });
  return db;
}

/** Đẩy mốc chuẩn lên, KHÔNG xếp lại lịch — đúng như sau khi PM "Close period". */
function setStatusDate(db: Db, date: string): Db {
  db.prepare('UPDATE project SET status_date = ? WHERE id = ?').run(date, 'P');
  return db;
}

function row(db: Db, name: string) {
  const found = loadProgressBoard(db, 'P', null).rows.find((r) => r.name === name);
  if (found === undefined) throw new Error(`khong co dong ${name}`);
  return found;
}

describe('đề xuất bám theo status_date (§10.5)', () => {
  it('trước khi bắt đầu → not_started', () => {
    const db = setStatusDate(build(), '2026-03-01');
    expect(row(db, 'Big').suggestion.status).toBe('not_started');
    expect(row(db, 'Big').suggestion.percent).toBe(0);
  });

  it('đúng ngày bắt đầu → in_progress 0%, chưa trôi ngày công nào', () => {
    const db = setStatusDate(build(), '2026-03-02');
    const s = row(db, 'Big').suggestion;
    expect(s.status).toBe('in_progress');
    expect(s.percent).toBe(0);
    expect(s.actualStart).toBe('2026-03-02');
  });

  it('giữa chừng → % theo số NGÀY CÔNG đã trôi, cuối tuần không tính', () => {
    // 02/03 là thứ Hai. status_date = thứ Năm 05/03 → đã trôi T2,T3,T4 = 3/5.
    const db = setStatusDate(build(), '2026-03-05');
    expect(row(db, 'Big').suggestion.percent).toBe(60);
  });

  it('qua hạn → done 100%, actual lấy theo plan', () => {
    const db = setStatusDate(build(), '2026-03-20');
    const r = row(db, 'Big');
    expect(r.suggestion.status).toBe('done');
    expect(r.suggestion.percent).toBe(100);
    expect(r.suggestion.actualStart).toBe(r.planStart);
    expect(r.suggestion.actualEnd).toBe(r.planEnd);
  });
});

describe('micro task (§7.9)', () => {
  it('0.25 MD được nhận là micro task', () => {
    expect(row(setStatusDate(build(), '2026-03-05'), 'Tiny').isMicro).toBe(true);
    expect(row(setStatusDate(build(), '2026-03-05'), 'Big').isMicro).toBe(false);
  });

  it('micro task đang chạy KHÔNG bao giờ được đề xuất in_progress', () => {
    const db = setStatusDate(build(), '2026-03-10');
    const r = row(db, 'Tiny');
    expect(r.planStart !== null && r.planStart <= '2026-03-10').toBe(true);
    expect(r.suggestion.status).not.toBe('in_progress');
  });
});

describe('gom dòng "on track" (§10.5)', () => {
  it('chưa nhập + đề xuất cũng not_started → on track, lead khỏi nhìn', () => {
    const db = setStatusDate(build(), '2026-03-01');
    const r = row(db, 'Big');
    expect(r.saved).toBeNull();
    expect(r.onTrack).toBe(true);
  });

  it('chưa nhập nhưng đã QUÁ HẠN → KHÔNG on track, phải hiện ra', () => {
    // Đây là dòng cần nhìn nhất. Gom nó đi là hỏng cả màn hình.
    const db = setStatusDate(build(), '2026-03-20');
    const r = row(db, 'Big');
    expect(r.saved).toBeNull();
    expect(r.onTrack).toBe(false);
  });

  it('đã nhập đúng bằng đề xuất → on track', () => {
    const db = setStatusDate(build(), '2026-03-20');
    const uid = row(db, 'Big').uid;
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,actual_start,actual_end,updated_by,updated_at)
       VALUES (?,'done',100,'2026-03-02','2026-03-06','U',?)`,
    ).run(uid, AT);
    expect(row(db, 'Big').onTrack).toBe(true);
  });

  it('lead cố ý ghi khác đề xuất → KHÔNG on track', () => {
    const db = setStatusDate(build(), '2026-03-20');
    const uid = row(db, 'Big').uid;
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,blocked_note,updated_by,updated_at)
       VALUES (?,'blocked',30,'Waiting for API key','U',?)`,
    ).run(uid, AT);
    const r = row(db, 'Big');
    expect(r.onTrack).toBe(false);
    expect(r.saved?.blockedNote).toBe('Waiting for API key');
  });
});

describe('dữ liệu kèm theo cho UI', () => {
  it('không trả về dòng summary — summary không nhập tiến độ được', () => {
    const rows = loadProgressBoard(setStatusDate(build(), '2026-03-05'), 'P', null).rows;
    expect(rows.map((r) => r.name)).not.toContain('Phase');
  });

  it('kèm tên cụm cha để gom micro task theo cụm', () => {
    expect(row(setStatusDate(build(), '2026-03-05'), 'Tiny').parentName).toBe('Phase');
  });

  it('kèm status_date và ngưỡng micro task', () => {
    const b = loadProgressBoard(setStatusDate(build(), '2026-03-05'), 'P', null);
    expect(b.statusDate).toBe('2026-03-05');
    expect(b.microThreshold).toBe(0.5);
  });

  it('lọc theo team chỉ trả task của team đó', () => {
    const db = setStatusDate(build(), '2026-03-05');
    expect(loadProgressBoard(db, 'P', 'TM').rows.length).toBeGreaterThan(0);
    expect(loadProgressBoard(db, 'P', 'TM-khong-ton-tai').rows).toEqual([]);
  });
});
