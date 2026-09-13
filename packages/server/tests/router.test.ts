import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { appRouter, type Context } from '../src/router/index.js';
import { historyOf } from '../src/audit/audit-log.js';

const AT = '2026-09-13T09:00:00.000Z';
let db: ReturnType<typeof openDatabase>;

function ctx(userId: string | null, isAdmin = false): Context {
  return {
    db,
    user: userId === null ? null : { userId, isAdmin },
    now: AT,
    dbPath: ':memory:',
  };
}
const caller = (userId: string | null, isAdmin = false) =>
  appRouter.createCaller(ctx(userId, isAdmin));

/**
 * Khẳng định MÃ lỗi tRPC, không phải chuỗi thông điệp.
 *
 * Client nhận `code`; thông điệp là văn bản có thể đổi bất cứ lúc nào mà không ai coi
 * là thay đổi hành vi. Khớp chuỗi ở đây sẽ vừa đỏ giả khi sửa câu chữ, vừa xanh giả khi
 * một lỗi khác tình cờ chứa cùng từ.
 */
async function expectTrpcCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Kỳ vọng lỗi ${code} nhưng procedure chạy trót lọt`);
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
     VALUES ('P','UTG','UTG',1,'2026-01-05','2026-01-05','CAL','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO team (id,project_id,name) VALUES ('TM-BE','P','BE')`).run();
  db.prepare(`INSERT INTO team (id,project_id,name) VALUES ('TM-QA','P','QA')`).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(
    `INSERT INTO resource_team (resource_id,project_id,team_id) VALUES ('R-1','P','TM-BE')`,
  ).run();

  for (const [id, email] of [
    ['U-PM', 'pm@x.com'],
    ['U-LEAD', 'lead@x.com'],
    ['U-OUT', 'out@x.com'],
  ]) {
    db.prepare(
      `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES (?,?,?,'h',?)`,
    ).run(id, email, id, AT);
  }
  db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P','pm')`).run();
  db.prepare(
    `INSERT INTO user_project (user_id,project_id,role,team_id) VALUES ('U-LEAD','P','lead','TM-BE')`,
  ).run();

  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 2, role: 'Dev' },
      ],
      dependencies: [],
    },
    { runId: 'I', now: AT },
  );
  // Gan nguoi de co team cho task.
  db.prepare(
    `INSERT INTO assignment (task_uid,resource_id,allocation,from_date,to_date)
     VALUES ('T-0002','R-1',1,'2026-01-05','2026-01-06')`,
  ).run();
});
afterEach(() => db.close());

describe('chưa đăng nhập thì không vào được gì (§13.3)', () => {
  it('mọi procedure trả UNAUTHORIZED', async () => {
    const anon = caller(null);
    await expectTrpcCode(anon.projects.list(), 'UNAUTHORIZED');
    await expectTrpcCode(anon.wbs.tree({ projectId: 'P' }), 'UNAUTHORIZED');
    await expectTrpcCode(anon.issues.list({ projectId: 'P' }), 'UNAUTHORIZED');
  });
});

describe('S0 — project switcher', () => {
  it('chỉ thấy dự án được gán', async () => {
    expect(await caller('U-PM').projects.list()).toHaveLength(1);
    expect(await caller('U-OUT').projects.list()).toHaveLength(0);
  });

  it('admin thấy mọi dự án dù không được gán', async () => {
    expect(await caller('U-OUT', true).projects.list()).toHaveLength(1);
  });
});

describe('S1 — WBS tree, quyền kiểm ở SERVER (§10.6)', () => {
  it('PM đọc được cây', async () => {
    const tree = await caller('U-PM').wbs.tree({ projectId: 'P' });
    expect(tree.length).toBe(2);
    expect(tree[0]?.wbsCode).toBe('1');
  });

  it('người ngoài dự án bị FORBIDDEN, không phải danh sách rỗng', async () => {
    await expectTrpcCode(caller('U-OUT').wbs.tree({ projectId: 'P' }), 'FORBIDDEN');
  });

  it('PM sửa được task, và thay đổi có vết trong audit_log', async () => {
    await caller('U-PM').wbs.updateTask({
      taskUid: 'T-0002',
      name: 'A doi ten',
      effortMd: 5,
      role: 'Dev',
      priority: 100,
    });
    const rows = historyOf(db, 'task', 'T-0002');
    expect(rows.map((r) => r.field).sort()).toEqual(['effortMd', 'name', 'priority']);
    expect(rows.every((r) => r.userId === 'U-PM')).toBe(true);
  });

  it('LEAD KHÔNG sửa được cây — §10.6 ô đó là ❌', async () => {
    await expectTrpcCode(
      caller('U-LEAD').wbs.updateTask({
        taskUid: 'T-0002',
        name: 'x',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
      }),
      'FORBIDDEN',
    );
  });

  it('lead bị chặn thì KHÔNG có thay đổi lẫn vết nào', async () => {
    await expect(
      caller('U-LEAD').wbs.updateTask({
        taskUid: 'T-0002',
        name: 'x',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
      }),
    ).rejects.toThrow();
    expect(historyOf(db, 'task', 'T-0002')).toEqual([]);
    const row = db.prepare('SELECT name FROM task WHERE uid = ?').get('T-0002') as { name: string };
    expect(row.name).toBe('A');
  });

  it('lead KHÔNG chạy được Recalculate all — §10.6 chỉ admin', async () => {
    await expectTrpcCode(
      caller('U-PM').wbs.recalculate({ projectId: 'P', scope: 'all' }),
      'FORBIDDEN',
    );
  });
});

describe('S4 — progress entry (§10.5, §10.6)', () => {
  it('lead chỉ thấy task của team mình', async () => {
    const rows = await caller('U-LEAD').progress.list({ projectId: 'P' });
    expect(rows.every((r) => r.teamId === 'TM-BE')).toBe(true);
  });

  it('PM thấy mọi task, không lọc theo team', async () => {
    const rows = await caller('U-PM').progress.list({ projectId: 'P' });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('lead ghi được cho task team mình', async () => {
    const r = await caller('U-LEAD').progress.save({
      rows: [
        {
          taskUid: 'T-0002',
          status: 'done',
          percent: 100,
          actualStart: '2026-01-05',
          actualEnd: '2026-01-06',
        },
      ],
    });
    expect(r).toEqual({ saved: 1 });
  });

  it('lead KHÔNG ghi được cho task team khác', async () => {
    db.prepare(`UPDATE resource_team SET team_id = 'TM-QA' WHERE resource_id = 'R-1'`).run();
    await expectTrpcCode(
      caller('U-LEAD').progress.save({
        rows: [
          { taskUid: 'T-0002', status: 'done', percent: 100, actualStart: null, actualEnd: null },
        ],
      }),
      'FORBIDDEN',
    );
  });

  it('một dòng bị chặn thì CẢ LÔ rollback — không lưu nửa vời (§10.5)', async () => {
    db.prepare(`UPDATE resource_team SET team_id = 'TM-QA' WHERE resource_id = 'R-1'`).run();
    await expect(
      caller('U-LEAD').progress.save({
        rows: [
          { taskUid: 'T-0002', status: 'done', percent: 100, actualStart: null, actualEnd: null },
        ],
      }),
    ).rejects.toThrow();
    const n = db.prepare('SELECT COUNT(*) AS n FROM progress').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('lưu xong có vết trong audit_log', async () => {
    await caller('U-PM').progress.save({
      rows: [
        {
          taskUid: 'T-0002',
          status: 'in_progress',
          percent: 40,
          actualStart: '2026-01-05',
          actualEnd: null,
        },
      ],
    });
    expect(historyOf(db, 'progress', 'T-0002').length).toBeGreaterThan(0);
  });
});

describe('S6 — issues', () => {
  it('đọc được và lọc theo dự án', async () => {
    db.prepare(
      `INSERT INTO validation_issue (run_id,project_id,severity,code,message,detected_at)
       VALUES ('RUN-1','P','Major','J05','Task too large',?)`,
    ).run(AT);
    const rows = await caller('U-PM').issues.list({ projectId: 'P' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('J05');
  });

  it('người ngoài dự án bị chặn', async () => {
    await expectTrpcCode(caller('U-OUT').issues.list({ projectId: 'P' }), 'FORBIDDEN');
  });
});

// ── P9 · S4 — ràng buộc §10.5 kiểm ở SERVER ─────────────────────────────────

describe('S4 — server KHÔNG tin client (§10.5, §10.6)', () => {
  /** Lưu một dòng hợp lệ để có mốc so sánh "đường hạnh phúc vẫn chạy". */
  const okRow = {
    taskUid: 'T-0002',
    status: 'in_progress' as const,
    percent: 50,
    actualStart: '2026-01-05',
    actualEnd: null,
    blockedNote: null,
  };

  it('dòng hợp lệ lưu được', async () => {
    expect(await caller('U-PM').progress.save({ rows: [okRow] })).toEqual({ saved: 1 });
  });

  it('actual_end trước actual_start bị TỪ CHỐI, dù UI có gửi lên', async () => {
    await expectTrpcCode(
      caller('U-PM').progress.save({
        rows: [{ ...okRow, status: 'done', percent: 100, actualEnd: '2026-01-01' }],
      }),
      'BAD_REQUEST',
    );
  });

  it('actual_start sau status_date bị từ chối', async () => {
    await expectTrpcCode(
      caller('U-PM').progress.save({ rows: [{ ...okRow, actualStart: '2026-06-01' }] }),
      'BAD_REQUEST',
    );
  });

  it('blocked mà không có ghi chú bị từ chối', async () => {
    await expectTrpcCode(
      caller('U-PM').progress.save({ rows: [{ ...okRow, status: 'blocked', blockedNote: null }] }),
      'BAD_REQUEST',
    );
  });

  it('blocked có ghi chú thì lưu, và ghi chú xuống ĐÚNG cột', async () => {
    await caller('U-PM').progress.save({
      rows: [{ ...okRow, status: 'blocked', blockedNote: 'Waiting for client API key' }],
    });
    const saved = db
      .prepare('SELECT status, blocked_note FROM progress WHERE task_uid = ?')
      .get('T-0002') as { status: string; blocked_note: string };
    expect(saved.status).toBe('blocked');
    expect(saved.blocked_note).toBe('Waiting for client API key');
  });

  it('MỘT dòng hỏng thì CẢ LÔ không được ghi — §10.5 "một transaction"', async () => {
    await expectTrpcCode(
      caller('U-PM').progress.save({
        rows: [okRow, { ...okRow, status: 'blocked', blockedNote: '  ' }],
      }),
      'BAD_REQUEST',
    );
    const count = db.prepare('SELECT COUNT(*) AS n FROM progress').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('task không tồn tại trả NOT_FOUND', async () => {
    await expectTrpcCode(
      caller('U-PM').progress.save({ rows: [{ ...okRow, taskUid: 'T-9999' }] }),
      'NOT_FOUND',
    );
  });
});

describe('S4 — bảng đề xuất (§10.5)', () => {
  it('PM thấy cả bảng, kèm status_date và ngưỡng micro task', async () => {
    const board = await caller('U-PM').progress.board({ projectId: 'P' });
    expect(board.statusDate).toBe('2026-01-05');
    expect(board.microThreshold).toBe(0.5);
    expect(board.rows.map((r) => r.name)).toContain('A');
  });

  it('không có dòng summary trong bảng nhập tiến độ', async () => {
    const board = await caller('U-PM').progress.board({ projectId: 'P' });
    expect(board.rows.map((r) => r.name)).not.toContain('Root');
  });

  it('lead chỉ thấy task của team mình', async () => {
    const board = await caller('U-LEAD').progress.board({ projectId: 'P' });
    expect(board.rows.every((r) => r.teamId === 'TM-BE')).toBe(true);
  });

  it('người ngoài dự án không đọc được', async () => {
    await expectTrpcCode(caller('U-OUT').progress.board({ projectId: 'P' }), 'FORBIDDEN');
  });
});
