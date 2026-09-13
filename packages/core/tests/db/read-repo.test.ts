/**
 * §7.7 nói summary "không có dữ liệu riêng, tính lúc đọc". Đây là chỗ duy nhất thực hiện
 * điều đó, nên nếu không kiểm ở đây thì mọi dòng summary trên S1 hiện ra rỗng mà không
 * test nào đỏ — đúng kiểu lỗi chỉ người dùng nhìn thấy.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { loadWbsTree } from '../../src/db/repo/read-repo.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleProject } from '../../src/pipeline/schedule-project.js';

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
     VALUES ('P','UTG','UTG',1,'2026-01-05','2026-01-05','CAL','VN',?)`,
  ).run(AT);
  db.prepare('INSERT INTO team (id,project_id,name) VALUES (?,?,?)').run('TM', 'P', 'BE');
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
        { tmp_id: 'a', parent_tmp_id: 'S', name: 'A', kind: 'work', effort_md: 2, role: 'Dev' },
        { tmp_id: 'b', parent_tmp_id: 'S', name: 'B', kind: 'work', effort_md: 3, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'r1', now: AT },
  );
  scheduleProject(db, { projectId: 'P', runId: 'r2', now: AT });
});

function byName(name: string) {
  const row = loadWbsTree(db, 'P').find((r) => r.name === name);
  if (row === undefined) throw new Error(`khong tim thay dong ${name}`);
  return row;
}

describe('loadWbsTree — summary được tính lúc đọc (§7.7)', () => {
  it('summary có ngày trải từ con sớm nhất tới con muộn nhất', () => {
    const a = byName('A');
    const b = byName('B');
    const s = byName('Phase');

    expect(a.planStart).not.toBeNull();
    expect(b.planEnd).not.toBeNull();
    expect(s.planStart).toBe(a.planStart);
    expect(s.planEnd).toBe(b.planEnd);
  });

  it('summary hiện TỔNG MD của con, dù task.effort_md trong DB là null', () => {
    expect(byName('Phase').effortMd).toBe(5);

    const stored = db.prepare(`SELECT effort_md FROM task WHERE name='Phase'`).get() as {
      effort_md: number | null;
    };
    // §7.7 cấm ghi số tổng xuống DB — nó phải là kết quả tính, không phải dữ liệu.
    expect(stored.effort_md).toBeNull();
  });

  it('status của summary lăn lên theo tiến độ của con', () => {
    expect(byName('Phase').status).toBe('not_started');

    const uidA = byName('A').uid;
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
       VALUES (?,'done',100,'U',?)`,
    ).run(uidA, AT);

    expect(byName('Phase').status).toBe('in_progress');
    // Trọng số theo MD: A xong 2/5 MD → 40%.
    expect(byName('Phase').percent).toBe(40);
  });

  it('summary KHÔNG bị gán đường găng — CPM chỉ chạy trên task thật', () => {
    const s = byName('Phase');
    expect(s.isCritical).toBe(false);
    expect(s.totalFloat).toBeNull();
  });

  it('task thật vẫn giữ nguyên số của chính nó', () => {
    const a = byName('A');
    expect(a.effortMd).toBe(2);
    expect(a.planStart).not.toBeNull();
  });
});

describe('loadWbsTree — số liên kết của mỗi dòng', () => {
  it('đếm cả hai chiều, để PM thấy dòng nào có ràng buộc mà không phải mở từng dòng', () => {
    // Fixture chỉ có một cạnh A --FS--> B: mỗi đầu đếm 1.
    expect(byName('A').linkCount).toBe(1);
    expect(byName('B').linkCount).toBe(1);
  });

  it('dòng không nối gì đếm 0', () => {
    expect(byName('Phase').linkCount).toBe(0);
  });
});
