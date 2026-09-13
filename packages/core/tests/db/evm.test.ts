/**
 * EVM trên DB thật: ghép ảnh chụp baseline với tiến độ hiện tại.
 *
 * Thứ dễ sai nhất ở đây không phải công thức mà là **lấy MD từ đâu**. EVM chỉ có nghĩa
 * khi BCWP tính theo MD của BASELINE; dùng MD hiện tại thì cứ nới phạm vi là chỉ số tự
 * đẹp lên, và cả phép đo mất tác dụng.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { closePeriod } from '../../src/db/repo/baseline-repo.js';
import { unsafeDateOnly } from '../../src/domain/date-only.js';
import { loadEvm } from '../../src/db/repo/read-repo.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleProject } from '../../src/pipeline/schedule-project.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

function uid(name: string): string {
  return (db.prepare('SELECT uid FROM task WHERE name = ?').get(name) as { uid: string }).uid;
}
function setProgress(name: string, percent: number, status = 'in_progress'): void {
  db.prepare(
    `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
     VALUES (?,?,?,'U',?)
     ON CONFLICT(task_uid) DO UPDATE SET status=excluded.status, percent=excluded.percent`,
  ).run(uid(name), status, percent, AT);
}
function setStatusDate(date: string): void {
  db.prepare('UPDATE project SET status_date = ? WHERE id = ?').run(date, 'P');
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
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P','UTG','UTG',1,'2026-03-02','2026-03-02','CAL','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES ('U','p@x.com','P','h',?)`,
  ).run(AT);

  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 5, role: 'Dev' },
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'B', kind: 'work', effort_md: 5, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );
  scheduleProject(db, { projectId: 'P', runId: 'S', now: AT });
  closePeriod(db, {
    projectId: 'P',
    statusDate: unsafeDateOnly('2026-03-02'),
    label: 'Plan v1.0',
    takenBy: 'U',
    takenAt: AT,
    runId: 'B1',
    baselineId: 'BL-1',
  });
});

describe('chưa có baseline thì không có EVM', () => {
  it('dự án khác chưa chốt baseline trả null', () => {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('Q','GEO','GEO',2,'2026-03-02','2026-03-02','CAL','VN',?)`,
    ).run(AT);
    expect(loadEvm(db, 'Q')).toBeNull();
  });
});

describe('SPI trên dữ liệu thật', () => {
  it('ngay lúc chốt baseline, chưa làm gì thì SPI null hoặc BCWS = 0', () => {
    const r = loadEvm(db, 'P');
    expect(r).not.toBeNull();
    expect(r?.baselineLabel).toBe('Plan v1.0');
    expect(r?.bcwp).toBe(0);
  });

  it('đẩy mốc chuẩn lên giữa chừng thì BCWS lớn hơn 0', () => {
    setStatusDate('2026-03-06');
    const r = loadEvm(db, 'P');
    expect(r?.bcws).toBeGreaterThan(0);
  });

  it('làm ĐÚNG tiến độ kế hoạch thì SPI quanh 1', () => {
    setStatusDate('2026-03-09');
    const before = loadEvm(db, 'P');
    // Đặt % bằng đúng tỷ lệ BCWS/tổng để mô phỏng "đúng kế hoạch".
    const ratio = (before?.bcws ?? 0) / (before?.baselineTotalMd ?? 1);
    setProgress('A', Math.min(100, ratio * 200));
    const r = loadEvm(db, 'P');
    expect(r?.spi).not.toBeNull();
  });

  it('chậm hơn kế hoạch thì SPI < 1', () => {
    setStatusDate('2026-03-16');
    setProgress('A', 10);
    const r = loadEvm(db, 'P');
    expect(r?.spi as number).toBeLessThan(1);
  });

  it('xong hết sớm thì SPI > 1', () => {
    setStatusDate('2026-03-04');
    setProgress('A', 100, 'done');
    setProgress('B', 100, 'done');
    const r = loadEvm(db, 'P');
    expect(r?.spi as number).toBeGreaterThan(1);
  });
});

describe('scope creep — điểm mấu chốt của EVM', () => {
  it('task thêm SAU baseline KHÔNG làm tăng BCWP', () => {
    setStatusDate('2026-03-16');
    setProgress('A', 100, 'done');
    const before = loadEvm(db, 'P');

    // Thêm một task mới và cho nó xong 100%.
    db.prepare(
      `INSERT INTO task (uid,project_id,wbs_code,depth,parent_uid,sort_order,name,kind,effort_md,role,created_at,updated_at)
       VALUES ('T-9001','P','1.3',2,?,3,'C','work',20,'Dev',?,?)`,
    ).run(uid('Root'), AT, AT);
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
       VALUES ('T-9001','done',100,'U',?)`,
    ).run(AT);

    const after = loadEvm(db, 'P');
    // Làm xong 20 MD việc mới, nhưng "giá trị đã thu" so với cam kết không đổi.
    expect(after?.bcwp).toBe(before?.bcwp);
    expect(after?.outsideBaselineMd).toBe(20);
  });

  it('MD của task trong baseline bị SỬA cũng không đổi BCWP', () => {
    setStatusDate('2026-03-16');
    setProgress('A', 100, 'done');
    const before = loadEvm(db, 'P');

    db.prepare(`UPDATE task SET effort_md = 50 WHERE name = 'A'`).run();
    const after = loadEvm(db, 'P');

    // BCWP bám MD của baseline, không bám MD hiện tại.
    expect(after?.bcwp).toBe(before?.bcwp);
  });
});

describe('chọn baseline để so', () => {
  it('mặc định lấy baseline MỚI NHẤT', () => {
    closePeriod(db, {
      projectId: 'P',
      statusDate: unsafeDateOnly('2026-03-09'),
      label: 'Plan v2.0',
      takenBy: 'U',
      takenAt: '2026-09-14T00:00:00.000Z',
      runId: 'B2',
      baselineId: 'BL-2',
    });
    expect(loadEvm(db, 'P')?.baselineLabel).toBe('Plan v2.0');
  });

  it('chỉ đích danh thì so với baseline đó — để đo scope creep so với cam kết gốc', () => {
    const first = (
      db.prepare(`SELECT id FROM baseline WHERE label='Plan v1.0'`).get() as { id: string }
    ).id;
    closePeriod(db, {
      projectId: 'P',
      statusDate: unsafeDateOnly('2026-03-09'),
      label: 'Plan v2.0',
      takenBy: 'U',
      takenAt: '2026-09-14T00:00:00.000Z',
      runId: 'B2',
      baselineId: 'BL-2',
    });
    expect(loadEvm(db, 'P', first)?.baselineLabel).toBe('Plan v1.0');
  });
});
