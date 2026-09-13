/**
 * Tạo / xoá task và sửa dependency — §10.4, §12.2.
 *
 * Cho tới trước đây, đường DUY NHẤT ghi vào bảng `task` là importer: muốn thêm một dòng
 * thì phải sửa file JSON rồi nạp lại cả gói. Với một tool lập kế hoạch thì đó là lỗ hổng
 * cơ bản nhất, nên phần này có test dày.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import {
  createTask,
  deleteDependency,
  deleteSubtree,
  setDependency,
  subtreeOf,
} from '../../src/db/repo/read-repo.js';
import { importTasks } from '../../src/io/importer.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

function uid(name: string): string {
  return (db.prepare('SELECT uid FROM task WHERE name = ?').get(name) as { uid: string }).uid;
}
function codes(): Record<string, string> {
  const rows = db.prepare('SELECT name, wbs_code FROM task').all() as Array<{
    name: string;
    wbs_code: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.name, r.wbs_code]));
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
  for (const [id, code] of [
    ['P', 'UTG'],
    ['Q', 'GEO'],
  ]) {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES (?,?,?,1,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(id, code, code, AT);
  }
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
        { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 1, role: 'Dev' },
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'B', kind: 'work', effort_md: 1, role: 'Dev' },
      ],
      dependencies: [],
    },
    { runId: 'I', now: AT },
  );
  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'GEO',
      mode: 'merge',
      tasks: [{ tmp_id: 'g', parent_tmp_id: null, name: 'GEO root', kind: 'summary' }],
      dependencies: [],
    },
    { runId: 'I2', now: AT },
  );
});

describe('createTask', () => {
  it('thêm vào CUỐI khi không nói chèn sau ai', () => {
    const r = createTask(db, {
      projectId: 'P',
      parentUid: uid('Root'),
      name: 'C',
      kind: 'work',
      effortMd: 2,
      role: 'Dev',
      priority: 500,
      now: AT,
    });
    expect(r.wbsCode).toBe('1.3');
    expect(codes()).toMatchObject({ A: '1.1', B: '1.2', C: '1.3' });
  });

  it('chèn vào GIỮA thì đẩy anh em phía sau xuống', () => {
    createTask(db, {
      projectId: 'P',
      parentUid: uid('Root'),
      name: 'A2',
      kind: 'work',
      effortMd: 1,
      role: 'Dev',
      priority: 500,
      afterUid: uid('A'),
      now: AT,
    });
    expect(codes()).toMatchObject({ A: '1.1', A2: '1.2', B: '1.3' });
  });

  it('tạo ở GỐC được, thành cây thứ hai', () => {
    const r = createTask(db, {
      projectId: 'P',
      parentUid: null,
      name: 'Root 2',
      kind: 'summary',
      effortMd: null,
      role: null,
      priority: 500,
      now: AT,
    });
    expect(r.wbsCode).toBe('2');
  });

  it('uid mới KHÔNG trùng uid đã có', () => {
    const before = new Set(
      (db.prepare('SELECT uid FROM task').all() as Array<{ uid: string }>).map((r) => r.uid),
    );
    const r = createTask(db, {
      projectId: 'P',
      parentUid: uid('Root'),
      name: 'C',
      kind: 'work',
      effortMd: 1,
      role: 'Dev',
      priority: 500,
      now: AT,
    });
    expect(before.has(r.uid)).toBe(false);
  });

  it('cha thuộc dự án KHÁC bị từ chối — cây WBS thuộc đúng một dự án', () => {
    expect(() =>
      createTask(db, {
        projectId: 'P',
        parentUid: uid('GEO root'),
        name: 'X',
        kind: 'work',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
        now: AT,
      }),
    ).toThrow(/dự án khác/);
  });

  it('cha không tồn tại bị từ chối', () => {
    expect(() =>
      createTask(db, {
        projectId: 'P',
        parentUid: 'T-9999',
        name: 'X',
        kind: 'work',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
        now: AT,
      }),
    ).toThrow(/không tồn tại/);
  });

  it('dự án khác KHÔNG bị đánh số lại lây', () => {
    const geo = codes()['GEO root'];
    createTask(db, {
      projectId: 'P',
      parentUid: uid('Root'),
      name: 'C',
      kind: 'work',
      effortMd: 1,
      role: 'Dev',
      priority: 500,
      now: AT,
    });
    expect(codes()['GEO root']).toBe(geo);
  });
});

describe('xoá cây con — §12.2 phải nói TRƯỚC sẽ mất gì', () => {
  it('subtreeOf đếm đủ task trong nhánh, kể cả gốc nhánh', () => {
    const info = subtreeOf(db, uid('Root'));
    expect(info.uids).toHaveLength(3);
  });

  it('đếm cả số dòng tiến độ sẽ mất theo', () => {
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
       VALUES (?,'done',100,'U',?)`,
    ).run(uid('A'), AT);
    expect(subtreeOf(db, uid('Root')).progressRows).toBe(1);
    expect(subtreeOf(db, uid('B')).progressRows).toBe(0);
  });

  it('xoá lá thì chỉ mất lá, anh em được đánh số lại', () => {
    expect(deleteSubtree(db, uid('A'), 'P')).toBe(1);
    expect(codes()).toMatchObject({ Root: '1', B: '1.1' });
  });

  it('xoá summary kéo theo CẢ nhánh', () => {
    expect(deleteSubtree(db, uid('Root'), 'P')).toBe(3);
    expect(db.prepare(`SELECT COUNT(*) n FROM task WHERE project_id='P'`).get()).toEqual({ n: 0 });
  });

  it('tiến độ và dependency bị xoá theo (ON DELETE CASCADE)', () => {
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS', lagDays: 0 });
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
       VALUES (?,'done',100,'U',?)`,
    ).run(uid('A'), AT);

    deleteSubtree(db, uid('A'), 'P');
    expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM progress').get()).toEqual({ n: 0 });
  });
});

describe('dependency', () => {
  it('tạo được', () => {
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS', lagDays: 2 });
    const r = db.prepare('SELECT type, lag_days FROM dependency').get() as {
      type: string;
      lag_days: number;
    };
    expect(r).toEqual({ type: 'FS', lag_days: 2 });
  });

  it('đặt lại cùng cặp+loại thì CẬP NHẬT lag, không nhân đôi dòng', () => {
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS', lagDays: 2 });
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS', lagDays: 5 });
    expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT lag_days AS l FROM dependency').get()).toEqual({ l: 5 });
  });

  it('cùng cặp nhưng KHÁC loại là hai dòng — §6.1 cho phép SS+FF', () => {
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'SS', lagDays: 0 });
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FF', lagDays: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual({ n: 2 });
  });

  it('task phụ thuộc chính nó bị chặn', () => {
    expect(() =>
      setDependency(db, { predUid: uid('A'), succUid: uid('A'), type: 'FS', lagDays: 0 }),
    ).toThrow(/chính nó/);
  });

  it('xoá được, và báo đúng số dòng đã xoá', () => {
    setDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS', lagDays: 0 });
    expect(deleteDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS' })).toBe(1);
    expect(deleteDependency(db, { predUid: uid('A'), succUid: uid('B'), type: 'FS' })).toBe(0);
  });
});
