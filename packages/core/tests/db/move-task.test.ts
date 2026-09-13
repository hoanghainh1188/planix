/**
 * §10.4 cho kéo thả đổi cha, và §4.3 nói `wbs_code` đổi mỗi lần renumber. Cái đắt ở đây
 * không phải phép UPDATE — mà là đánh số lại: sai một chỗ thì hai task mang cùng một mã,
 * và mọi thứ đọc theo mã (báo cáo Excel §11.2 cột L, dependency hiển thị) lệch theo.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { MoveRejectedError, moveTask, setSequencing } from '../../src/db/repo/read-repo.js';
import { importTasks } from '../../src/io/importer.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

function codes(): Record<string, string> {
  const rows = db.prepare('SELECT name, wbs_code FROM task ORDER BY wbs_code').all() as Array<{
    name: string;
    wbs_code: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.name, r.wbs_code]));
}
function uid(name: string): string {
  const r = db.prepare('SELECT uid FROM task WHERE name = ?').get(name) as { uid: string };
  return r.uid;
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

  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev A','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();

  // Phase A { A1, A2 }, Phase B { B1 }
  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'pa', parent_tmp_id: 'r', name: 'Phase A', kind: 'summary' },
        { tmp_id: 'a1', parent_tmp_id: 'pa', name: 'A1', kind: 'work', effort_md: 1, role: 'Dev' },
        { tmp_id: 'a2', parent_tmp_id: 'pa', name: 'A2', kind: 'work', effort_md: 1, role: 'Dev' },
        { tmp_id: 'pb', parent_tmp_id: 'r', name: 'Phase B', kind: 'summary' },
        { tmp_id: 'b1', parent_tmp_id: 'pb', name: 'B1', kind: 'work', effort_md: 1, role: 'Dev' },
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

describe('đổi cha rồi ĐÁNH SỐ LẠI (§10.4, §4.3)', () => {
  it('trước khi chuyển, mã đúng như nhập vào', () => {
    expect(codes()).toMatchObject({
      Root: '1',
      'Phase A': '1.1',
      A1: '1.1.1',
      A2: '1.1.2',
      'Phase B': '1.2',
      B1: '1.2.1',
    });
  });

  it('chuyển A2 sang Phase B thì CẢ HAI nhánh được đánh số lại', () => {
    moveTask(db, { taskUid: uid('A2'), newParentUid: uid('Phase B'), newSortOrder: 99, now: AT });
    expect(codes()).toMatchObject({
      'Phase A': '1.1',
      A1: '1.1.1',
      'Phase B': '1.2',
      B1: '1.2.1',
      A2: '1.2.2',
    });
  });

  it('`uid` KHÔNG đổi khi mã đổi — mọi tham chiếu bám vào uid (§4.3)', () => {
    const before = uid('A2');
    moveTask(db, { taskUid: before, newParentUid: uid('Phase B'), newSortOrder: 99, now: AT });
    expect(uid('A2')).toBe(before);
  });

  it('đổi thứ tự trong cùng một cha cũng đánh số lại', () => {
    moveTask(db, { taskUid: uid('A2'), newParentUid: uid('Phase A'), newSortOrder: -1, now: AT });
    expect(codes()['A2']).toBe('1.1.1');
    expect(codes()['A1']).toBe('1.1.2');
  });

  it('đưa lên làm gốc thì depth về 1', () => {
    moveTask(db, { taskUid: uid('Phase A'), newParentUid: null, newSortOrder: 5, now: AT });
    const r = db.prepare('SELECT depth, wbs_code FROM task WHERE name = ?').get('Phase A') as {
      depth: number;
      wbs_code: string;
    };
    expect(r.depth).toBe(1);
    expect(r.wbs_code).toBe('2');
  });

  it('báo lại số task bị đổi mã, để UI nói được phạm vi ảnh hưởng', () => {
    const res = moveTask(db, {
      taskUid: uid('A2'),
      newParentUid: uid('Phase B'),
      newSortOrder: 99,
      now: AT,
    });
    expect(res.projectId).toBe('P');
    expect(res.renumbered).toBeGreaterThan(0);
  });
});

describe('chặn phép chuyển làm hỏng cây', () => {
  it('thả cha vào trong con của nó bị TỪ CHỐI', () => {
    expect(() =>
      moveTask(db, { taskUid: uid('Phase A'), newParentUid: uid('A1'), newSortOrder: 0, now: AT }),
    ).toThrow(MoveRejectedError);
  });

  it('bị từ chối thì DB không đổi gì', () => {
    const before = codes();
    try {
      moveTask(db, { taskUid: uid('Phase A'), newParentUid: uid('A1'), newSortOrder: 0, now: AT });
    } catch {
      /* mong đợi */
    }
    expect(codes()).toEqual(before);
  });

  it('không chuyển sang dự án khác', () => {
    expect(() =>
      moveTask(db, {
        taskUid: uid('A1'),
        newParentUid: uid('GEO root'),
        newSortOrder: 0,
        now: AT,
      }),
    ).toThrow(MoveRejectedError);
  });

  it('task không tồn tại', () => {
    expect(() =>
      moveTask(db, { taskUid: 'T-9999', newParentUid: null, newSortOrder: 0, now: AT }),
    ).toThrow(MoveRejectedError);
  });

  it('dự án KHÁC không bị đánh số lại lây', () => {
    const geoBefore = db.prepare(`SELECT wbs_code FROM task WHERE name='GEO root'`).get();
    moveTask(db, { taskUid: uid('A2'), newParentUid: uid('Phase B'), newSortOrder: 9, now: AT });
    expect(db.prepare(`SELECT wbs_code FROM task WHERE name='GEO root'`).get()).toEqual(geoBefore);
  });
});

describe('công tắc Parallel / Sequential (§6.3, §10.4)', () => {
  it('đặt được cả hai chiều', () => {
    const s = uid('Phase A');
    setSequencing(db, s, 'sequential', AT);
    expect(
      (db.prepare('SELECT child_sequencing AS m FROM task WHERE uid = ?').get(s) as { m: string })
        .m,
    ).toBe('sequential');

    setSequencing(db, s, 'parallel', AT);
    expect(
      (db.prepare('SELECT child_sequencing AS m FROM task WHERE uid = ?').get(s) as { m: string })
        .m,
    ).toBe('parallel');
  });
});
