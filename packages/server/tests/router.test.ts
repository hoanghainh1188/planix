import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { appRouter, type Context } from '../src/router/index.js';
import { historyOf } from '../src/audit/audit-log.js';
import { recordValidationRun } from '@planix/core/db/repo/issue-repo.js';

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
        {
          tmp_id: 'a',
          parent_tmp_id: 'r',
          name: 'A',
          kind: 'work',
          effort_md: 2,
          role: 'Dev',
          phase: 'P1',
          module: 'mod-1',
        },
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
    // Đi qua repo chứ không INSERT tay: issue nay gắn vào một DÒNG lượt (`run_pk`), nên
    // một dòng issue mồ côi sẽ không bao giờ được đọc ra — và test chèn tay như vậy sẽ
    // xanh giả ở bản cũ, đỏ ở bản mới mà chẳng nói lên điều gì về sản phẩm.
    recordValidationRun(db, {
      runId: 'RUN-1',
      projectId: 'P',
      detectedAt: AT,
      source: 'schedule',
      issues: [{ severity: 'Major', code: 'J05', message: 'Task too large' }],
    });
    const rows = await caller('U-PM').issues.list({ projectId: 'P' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('J05');
  });

  it('người ngoài dự án bị chặn', async () => {
    await expectTrpcCode(caller('U-OUT').issues.list({ projectId: 'P' }), 'FORBIDDEN');
  });

  // PM quyết ngày 2026-09-13: §8 chỉ liệt kê ba chỗ, nhưng panel phải khớp với thứ đang
  // nhìn thấy, nên mở ra mọi thao tác ghi WBS.
  describe('sửa WBS xong thì validate chạy lại ngay', () => {
    it('bỏ role của một task work → C04 hiện ra mà không cần bấm Recalculate', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      await caller('U-PM').wbs.updateTask({
        taskUid: uid,
        name: 'A',
        effortMd: 2,
        role: null,
        priority: 500,
      });

      const codes = (await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code);
      expect(codes).toContain('C04');
    });

    it('trả role lại thì C04 biến mất ngay', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      const edit = { taskUid: uid, name: 'A', effortMd: 2, priority: 500 };
      await caller('U-PM').wbs.updateTask({ ...edit, role: null });
      await caller('U-PM').wbs.updateTask({ ...edit, role: 'Dev' });

      const codes = (await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code);
      expect(codes).not.toContain('C04');
    });

    it('tạo task mới cũng chạy lại — task work chưa có role là C04 ngay lúc sinh ra', async () => {
      const root = (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string })
        .uid;
      await caller('U-PM').wbs.createTask({
        projectId: 'P',
        parentUid: root,
        name: 'Task khong co role',
        kind: 'work',
        effortMd: 1,
        role: null,
        priority: 500,
        afterUid: null,
      });

      expect((await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code)).toContain(
        'C04',
      );
    });

    it('lượt làm ĐỔI tập issue được ghi nguồn là `edit`', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      await caller('U-PM').wbs.updateTask({
        taskUid: uid,
        name: 'A',
        effortMd: 2,
        role: null, // sinh C04 — tập issue đổi, nên đây là một dòng lịch sử mới
        priority: 500,
      });
      expect(await caller('U-PM').issues.lastRun({ projectId: 'P' })).toMatchObject({
        source: 'edit',
        critical: 1,
      });
    });

    it('sửa mà không đổi gì thì `source` GIỮ nguyên — nó đi với `firstAt`', async () => {
      // Fixture vừa import xong, nên lượt hiện tại có nguồn `import`. Đổi tên task không
      // làm đổi tập issue, nên đây vẫn là trạng thái do import sinh ra: ghi đè nguồn
      // thành `edit` sẽ nói rằng vấn đề này xuất hiện vì một lần sửa, mà không phải.
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      await caller('U-PM').wbs.updateTask({
        taskUid: uid,
        name: 'A doi ten',
        effortMd: 2,
        role: 'Dev',
        priority: 500,
      });
      expect(await caller('U-PM').issues.lastRun({ projectId: 'P' })).toMatchObject({
        source: 'import',
      });
    });

    it('sửa mà KHÔNG đổi tập issue thì không đẻ dòng lịch sử mới', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      const edit = { taskUid: uid, effortMd: 2, role: 'Dev', priority: 500 };
      await caller('U-PM').wbs.updateTask({ ...edit, name: 'Ten 1' });
      const after1 = await caller('U-PM').issues.history({ projectId: 'P' });
      await caller('U-PM').wbs.updateTask({ ...edit, name: 'Ten 2' });
      await caller('U-PM').wbs.updateTask({ ...edit, name: 'Ten 3' });
      const after3 = await caller('U-PM').issues.history({ projectId: 'P' });

      expect(after3.length).toBe(after1.length);
    });
  });

  describe('lịch sử validate', () => {
    it('mới nhất trước, và giữ được lượt cũ', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      const edit = { taskUid: uid, name: 'A', effortMd: 2, priority: 500 };
      await caller('U-PM').wbs.updateTask({ ...edit, role: null }); // sinh C04
      await caller('U-PM').wbs.updateTask({ ...edit, role: 'Dev' }); // sạch lại

      const history = await caller('U-PM').issues.history({ projectId: 'P' });
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0]?.critical).toBe(0);
      expect(history.some((r) => r.critical > 0)).toBe(true);
    });

    it('xem lại được issue của một lượt cũ', async () => {
      const uid = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
      const edit = { taskUid: uid, name: 'A', effortMd: 2, priority: 500 };
      await caller('U-PM').wbs.updateTask({ ...edit, role: null });
      await caller('U-PM').wbs.updateTask({ ...edit, role: 'Dev' });

      const history = await caller('U-PM').issues.history({ projectId: 'P' });
      const broken = history.find((r) => r.critical > 0);
      expect(broken).toBeDefined();
      const issues = await caller('U-PM').issues.ofRun({
        projectId: 'P',
        runPk: broken?.id ?? 0,
      });
      expect(issues.map((i) => i.code)).toContain('C04');
    });

    it('không xem được lượt của dự án khác', async () => {
      db.prepare(
        `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
         VALUES ('Q','GEO','GEO',2,'2026-01-05','2026-01-05','CAL','VN',?)`,
      ).run(AT);
      db.prepare(
        `INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','Q','pm')`,
      ).run();
      recordValidationRun(db, {
        runId: 'geo',
        projectId: 'Q',
        detectedAt: AT,
        source: 'edit',
        issues: [{ severity: 'Major', code: 'J05', message: 'geo' }],
      });
      const geoRun = (await caller('U-PM').issues.history({ projectId: 'Q' }))[0];
      expect(geoRun).toBeDefined();

      // Cùng người, có quyền ở CẢ HAI dự án — nhưng `runPk` của Q không được đọc qua P.
      await expectTrpcCode(
        caller('U-PM').issues.ofRun({ projectId: 'P', runPk: geoRun?.id ?? 0 }),
        'NOT_FOUND',
      );
    });

    it('người ngoài dự án không đọc được lịch sử', async () => {
      await expectTrpcCode(caller('U-OUT').issues.history({ projectId: 'P' }), 'FORBIDDEN');
    });
  });

  // §8: "Chạy sau mỗi lần import, mỗi lần schedule, mỗi lần lưu progress."
  describe('lưu progress xong thì validate chạy và kết quả xuống bảng', () => {
    it('C11 hiện ra: `done` mà thiếu actual_start', async () => {
      // §10.5 chỉ bắt buộc `actual_end` khi done, KHÔNG bắt `actual_start` — nên dòng này
      // qua được cửa kiểm trường, rồi mới lộ ra ở validate toàn dự án (§8.1 C11).
      await caller('U-PM').progress.save({
        rows: [
          {
            taskUid: 'T-0002',
            status: 'done',
            percent: 100,
            actualStart: null,
            actualEnd: '2026-01-06',
            blockedNote: null,
          },
        ],
      });

      const codes = (await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code);
      expect(codes).toContain('C11');
    });

    it('sửa lại cho đủ ngày thì C11 biến mất', async () => {
      const row = {
        taskUid: 'T-0002',
        status: 'done' as const,
        percent: 100,
        actualStart: null as string | null,
        actualEnd: '2026-01-06',
        blockedNote: null,
      };
      await caller('U-PM').progress.save({ rows: [row] });
      expect((await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code)).toContain(
        'C11',
      );

      await caller('U-PM').progress.save({
        rows: [{ ...row, actualStart: '2026-01-05' }],
      });
      expect(
        (await caller('U-PM').issues.list({ projectId: 'P' })).map((i) => i.code),
      ).not.toContain('C11');
    });

    it('lưu hỏng giữa chừng thì không để lại issue của một lần lưu chưa xảy ra', async () => {
      await expectTrpcCode(
        caller('U-PM').progress.save({
          rows: [
            {
              taskUid: 'T-0002',
              status: 'done',
              percent: 100,
              actualStart: null,
              actualEnd: '2026-01-06',
              blockedNote: null,
            },
            {
              taskUid: 'T-9999',
              status: 'done',
              percent: 100,
              actualStart: null,
              actualEnd: '2026-01-06',
              blockedNote: null,
            },
          ],
        }),
        'NOT_FOUND',
      );
      expect(await caller('U-PM').issues.list({ projectId: 'P' })).toEqual([]);
    });
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

describe('S4 — nhật ký sửa tiến độ (§10.5 "ghi audit_log từng dòng")', () => {
  const base = {
    taskUid: 'T-0002',
    status: 'in_progress' as const,
    percent: 50,
    actualStart: '2026-01-05',
    actualEnd: null as string | null,
    blockedNote: null as string | null,
  };

  it('sửa ngày thực CÓ để lại vết — đó là thứ quyết định task có bị tính trễ hay không', async () => {
    // Fixture để `status_date` = 2026-01-05, mà §10.5 cấm `actual_start` vượt mốc chuẩn.
    // Đẩy mốc ra sau để còn chỗ mà sửa ngày.
    db.prepare(`UPDATE project SET status_date = '2026-06-30' WHERE id = 'P'`).run();
    await caller('U-PM').progress.save({ rows: [base] });
    const before = historyOf(db, 'progress', 'T-0002').length;

    // Chỉ đổi ngày thực, `status` và `percent` giữ nguyên.
    await caller('U-PM').progress.save({ rows: [{ ...base, actualStart: '2026-01-06' }] });

    const after = historyOf(db, 'progress', 'T-0002');
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((r) => r.field === 'actualStart')).toBe(true);
  });

  it('lưu lại y nguyên thì KHÔNG đẻ ra dòng nhật ký rỗng', async () => {
    await caller('U-PM').progress.save({ rows: [base] });
    const before = historyOf(db, 'progress', 'T-0002').length;
    await caller('U-PM').progress.save({ rows: [base] });
    expect(historyOf(db, 'progress', 'T-0002').length).toBe(before);
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

// ── P8 · đường GHI của S1 ───────────────────────────────────────────────────

describe('S1 — kéo thả đổi cha (§10.4)', () => {
  /**
   * Thêm một summary anh em để có chỗ chuyển qua lại.
   *
   * Chèn thẳng bằng SQL chứ không gọi `importTasks` lần nữa: import lần hai ở chế độ
   * merge sẽ dựng lại cả cây và đụng với cây `beforeEach` đã tạo (C08).
   */
  function branch(): { phaseB: string; a: string } {
    const root = (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string })
      .uid;
    db.prepare(
      `INSERT INTO task (uid,project_id,wbs_code,depth,parent_uid,sort_order,name,kind,created_at,updated_at)
       VALUES ('T-9001','P','1.2',2,?,2,'Phase B','summary',?,?)`,
    ).run(root, AT, AT);
    const a = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
    return { phaseB: 'T-9001', a };
  }

  it('PM chuyển được task sang nhánh khác, engine đánh số lại', async () => {
    const { phaseB, a } = branch();
    const res = await caller('U-PM').wbs.moveTask({
      taskUid: a,
      newParentUid: phaseB,
      newSortOrder: 10,
    });
    expect(res.renumbered).toBeGreaterThan(0);

    const moved = db.prepare('SELECT parent_uid, wbs_code FROM task WHERE uid = ?').get(a) as {
      parent_uid: string;
      wbs_code: string;
    };
    expect(moved.parent_uid).toBe(phaseB);
    expect(moved.wbs_code.startsWith('1.')).toBe(true);
  });

  it('thả vào con của chính nó bị từ chối BAD_REQUEST, không phải lỗi 500', async () => {
    const { a } = branch();
    const root = (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string })
      .uid;
    await expectTrpcCode(
      caller('U-PM').wbs.moveTask({ taskUid: root, newParentUid: a, newSortOrder: 0 }),
      'BAD_REQUEST',
    );
  });

  it('lead KHÔNG được đổi cấu trúc cây (§10.6)', async () => {
    const { phaseB, a } = branch();
    await expectTrpcCode(
      caller('U-LEAD').wbs.moveTask({ taskUid: a, newParentUid: phaseB, newSortOrder: 0 }),
      'FORBIDDEN',
    );
  });

  it('ghi vết vào audit_log', async () => {
    const { phaseB, a } = branch();
    await caller('U-PM').wbs.moveTask({ taskUid: a, newParentUid: phaseB, newSortOrder: 3 });
    expect(historyOf(db, 'task', a).length).toBeGreaterThan(0);
  });
});

describe('S1 — công tắc Parallel / Sequential (§6.3, §10.4)', () => {
  const summaryUid = (): string =>
    (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string }).uid;

  it('PM đặt được sequential rồi parallel', async () => {
    await caller('U-PM').wbs.setSequencing({ taskUid: summaryUid(), mode: 'sequential' });
    const read1 = db
      .prepare('SELECT child_sequencing AS m FROM task WHERE uid = ?')
      .get(summaryUid());
    expect((read1 as { m: string }).m).toBe('sequential');

    await caller('U-PM').wbs.setSequencing({ taskUid: summaryUid(), mode: 'parallel' });
    const read2 = db
      .prepare('SELECT child_sequencing AS m FROM task WHERE uid = ?')
      .get(summaryUid());
    expect((read2 as { m: string }).m).toBe('parallel');
  });

  it('đặt trên task LÁ bị từ chối — §6.3 chỉ nói về summary', async () => {
    const leaf = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
    await expectTrpcCode(
      caller('U-PM').wbs.setSequencing({ taskUid: leaf, mode: 'sequential' }),
      'BAD_REQUEST',
    );
  });

  it('lead không được đổi', async () => {
    await expectTrpcCode(
      caller('U-LEAD').wbs.setSequencing({ taskUid: summaryUid(), mode: 'sequential' }),
      'FORBIDDEN',
    );
  });
});

describe('S1 — xem trước recalculate KHÔNG ghi gì (§10.1)', () => {
  it('DB in-memory thì nói thẳng là không chạy thử được, thay vì trả bảng rỗng', async () => {
    // `ctx.dbPath` ở test là ':memory:' — không sao ra file được.
    const res = await caller('U-PM').wbs.previewRecalculate({ projectId: 'P', scope: 'project' });
    expect(res.result.ok).toBe(false);
    expect(res.before).toEqual(res.after);
  });

  it('lead không được chạy', async () => {
    await expectTrpcCode(
      caller('U-LEAD').wbs.previewRecalculate({ projectId: 'P', scope: 'project' }),
      'FORBIDDEN',
    );
  });

  it('PM không được xem trước phạm vi "all" — §10.6 chỉ admin', async () => {
    await expectTrpcCode(
      caller('U-PM').wbs.previewRecalculate({ projectId: 'P', scope: 'all' }),
      'FORBIDDEN',
    );
  });
});

// ── Tạo / xoá task, dependency (§10.4, §12.2) ───────────────────────────────

describe('S1 — tạo task', () => {
  const rootUid = (): string =>
    (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string }).uid;

  it('PM thêm được task vào cây', async () => {
    const r = await caller('U-PM').wbs.createTask({
      projectId: 'P',
      parentUid: rootUid(),
      name: 'Task mới',
      kind: 'work',
      effortMd: 2,
      role: 'Dev',
      priority: 500,
      afterUid: null,
    });
    expect(r.wbsCode).toMatch(/^1\./);
    expect(historyOf(db, 'task', r.uid).length).toBeGreaterThan(0);
  });

  it('lead KHÔNG được thêm task (§10.6)', async () => {
    await expectTrpcCode(
      caller('U-LEAD').wbs.createTask({
        projectId: 'P',
        parentUid: rootUid(),
        name: 'X',
        kind: 'work',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
        afterUid: null,
      }),
      'FORBIDDEN',
    );
  });

  it('cha không tồn tại trả BAD_REQUEST, không phải lỗi 500', async () => {
    await expectTrpcCode(
      caller('U-PM').wbs.createTask({
        projectId: 'P',
        parentUid: 'T-9999',
        name: 'X',
        kind: 'work',
        effortMd: 1,
        role: 'Dev',
        priority: 500,
        afterUid: null,
      }),
      'BAD_REQUEST',
    );
  });
});

describe('S1 — xoá cây con (§12.2)', () => {
  const leafUid = (): string =>
    (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;

  it('xem trước nói rõ sẽ mất bao nhiêu task và bao nhiêu dòng tiến độ', async () => {
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
       VALUES (?,'done',100,'U-PM',?)`,
    ).run(leafUid(), AT);

    const r = await caller('U-PM').wbs.subtreePreview({ taskUid: leafUid() });
    expect(r.taskCount).toBe(1);
    expect(r.progressRows).toBe(1);
  });

  it('xem trước KHÔNG xoá gì', async () => {
    await caller('U-PM').wbs.subtreePreview({ taskUid: leafUid() });
    expect(db.prepare('SELECT COUNT(*) n FROM task').get()).toEqual({ n: 2 });
  });

  it('xoá thật thì mất, và có vết trong audit_log', async () => {
    const uid = leafUid();
    const r = await caller('U-PM').wbs.deleteSubtree({ taskUid: uid });
    expect(r.removed).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM task').get()).toEqual({ n: 1 });
    expect(historyOf(db, 'task', uid).length).toBeGreaterThan(0);
  });

  it('lead không được xoá', async () => {
    await expectTrpcCode(caller('U-LEAD').wbs.deleteSubtree({ taskUid: leafUid() }), 'FORBIDDEN');
  });
});

describe('S1 — dependency', () => {
  function pair(): { a: string; b: string } {
    const a = (db.prepare(`SELECT uid FROM task WHERE name='A'`).get() as { uid: string }).uid;
    db.prepare(
      `INSERT INTO task (uid,project_id,wbs_code,depth,parent_uid,sort_order,name,kind,effort_md,role,phase,module,created_at,updated_at)
       VALUES ('T-8001','P','1.2',2,(SELECT uid FROM task WHERE name='Root'),2,'B','work',1,'Dev','P1','mod-1',?,?)`,
    ).run(AT, AT);
    return { a, b: 'T-8001' };
  }

  it('PM nối được hai task', async () => {
    const { a, b } = pair();
    await caller('U-PM').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 2 });
    expect(db.prepare('SELECT lag_days AS l FROM dependency').get()).toEqual({ l: 2 });
  });

  it('nối XUYÊN dự án bị từ chối', async () => {
    const { b } = pair();
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('Q','GEO','GEO',2,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(AT);
    db.prepare(
      `INSERT INTO task (uid,project_id,wbs_code,depth,sort_order,name,kind,created_at,updated_at)
       VALUES ('T-8002','Q','1',1,1,'GEO root','summary',?,?)`,
    ).run(AT, AT);

    await expectTrpcCode(
      caller('U-PM').wbs.setDependency({
        predUid: 'T-8002',
        succUid: b,
        type: 'FS',
        lagDays: 0,
      }),
      'BAD_REQUEST',
    );
  });

  it('task phụ thuộc chính nó trả BAD_REQUEST', async () => {
    const { a } = pair();
    await expectTrpcCode(
      caller('U-PM').wbs.setDependency({ predUid: a, succUid: a, type: 'FS', lagDays: 0 }),
      'BAD_REQUEST',
    );
  });

  it('xoá được', async () => {
    const { a, b } = pair();
    await caller('U-PM').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 0 });
    const r = await caller('U-PM').wbs.deleteDependency({ predUid: a, succUid: b, type: 'FS' });
    expect(r.removed).toBe(1);
  });

  it('lead không được nối', async () => {
    const { a, b } = pair();
    await expectTrpcCode(
      caller('U-LEAD').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 0 }),
      'FORBIDDEN',
    );
  });

  // §12.4: "sau mỗi tool ghi, tự động chạy validate và kèm ValidationReport vào response".
  // PM phải biết hậu quả NGAY lúc nối, chứ không phải lúc bấm Recalculate rồi mới bị chặn.
  describe('phản hồi validate ngay sau khi ghi (§12.4)', () => {
    it('nối thành vòng thì trả về C01 kèm đường đi', async () => {
      const { a, b } = pair();
      const first = await caller('U-PM').wbs.setDependency({
        predUid: a,
        succUid: b,
        type: 'FS',
        lagDays: 0,
      });
      expect(first.issues).toEqual([]);

      const closing = await caller('U-PM').wbs.setDependency({
        predUid: b,
        succUid: a,
        type: 'FS',
        lagDays: 0,
      });
      const cycle = closing.issues.find((i) => i.code === 'C01');
      expect(cycle?.severity).toBe('Critical');
      expect(cycle?.message).toMatch(/cycle/i);
      // Cạnh vẫn được ghi: §12.4 nói validate SAU khi ghi, không nói chặn ghi.
      expect(db.prepare('SELECT COUNT(*) n FROM dependency').get()).toEqual({ n: 2 });
    });

    it('nối ở cấp sâu hơn dependency_max_level trả về C12', async () => {
      // §6.2: chỉ được khai báo ở depth <= dependency_max_level (mặc định 3). Hai lá ở
      // depth 4 và KHÁC cha — cùng cha thì được miễn trừ, xem
      // docs/decisions/2026-09-13-c12-vs-sibling-edges.md.
      const root = (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string })
        .uid;
      const ins = db.prepare(
        `INSERT INTO task (uid,project_id,wbs_code,depth,parent_uid,sort_order,name,kind,effort_md,role,phase,module,created_at,updated_at)
         VALUES (?,'P',?,?,?,1,?,?,?,?,'P1','mod-1',?,?)`,
      );
      ins.run('T-9001', '1.1.1', 3, root, 'Mid A', 'summary', null, null, AT, AT);
      ins.run('T-9002', '1.1.1.1', 4, 'T-9001', 'Deep A', 'work', 1, 'Dev', AT, AT);
      ins.run('T-9003', '1.2.1', 3, root, 'Mid B', 'summary', null, null, AT, AT);
      ins.run('T-9004', '1.2.1.1', 4, 'T-9003', 'Deep B', 'work', 1, 'Dev', AT, AT);

      const r = await caller('U-PM').wbs.setDependency({
        predUid: 'T-9002',
        succUid: 'T-9004',
        type: 'FS',
        lagDays: 0,
      });
      expect(r.issues.map((i) => i.code)).toContain('C12');
    });

    it('chỉ trả issue của chính cạnh vừa sửa, không trả cả rổ issue của dự án', async () => {
      const { a, b } = pair();
      // Task 'Root' không có role nên dự án vốn đã có issue khác; chúng không được lẫn vào.
      const r = await caller('U-PM').wbs.setDependency({
        predUid: a,
        succUid: b,
        type: 'FS',
        lagDays: 0,
      });
      for (const issue of r.issues) {
        expect([a, b, undefined]).toContain(issue.taskUid);
      }
    });

    it('xoá cạnh cũng trả về phản hồi validate — gỡ vòng thì C01 biến mất', async () => {
      const { a, b } = pair();
      await caller('U-PM').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 0 });
      await caller('U-PM').wbs.setDependency({ predUid: b, succUid: a, type: 'FS', lagDays: 0 });
      const r = await caller('U-PM').wbs.deleteDependency({ predUid: b, succUid: a, type: 'FS' });
      expect(r.removed).toBe(1);
      expect(r.issues.map((i) => i.code)).not.toContain('C01');
    });
  });

  describe('đọc liên kết của một task', () => {
    it('trả cả hai chiều kèm tên, để panel hiện được ngay', async () => {
      const { a, b } = pair();
      await caller('U-PM').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 3 });

      const ofB = await caller('U-PM').wbs.dependencies({ taskUid: b });
      expect(ofB.predecessors).toHaveLength(1);
      expect(ofB.predecessors[0]?.name).toBe('A');
      expect(ofB.predecessors[0]?.lagDays).toBe(3);
      expect(ofB.successors).toEqual([]);
    });

    it('lead CHỈ ĐỌC vẫn xem được — xem ràng buộc không phải quyền sửa WBS', async () => {
      const { a, b } = pair();
      await caller('U-PM').wbs.setDependency({ predUid: a, succUid: b, type: 'FS', lagDays: 0 });
      const r = await caller('U-LEAD').wbs.dependencies({ taskUid: b });
      expect(r.predecessors).toHaveLength(1);
    });

    it('người ngoài dự án không xem được', async () => {
      const { b } = pair();
      await expectTrpcCode(caller('U-OUT').wbs.dependencies({ taskUid: b }), 'FORBIDDEN');
    });
  });
});

// ── S8 — Import (§9) ────────────────────────────────────────────────────────

describe('S8 — import', () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        {
          tmp_id: 'n1',
          parent_uid: (
            db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as {
              uid: string;
            }
          ).uid,
          name: 'Module moi',
          kind: 'summary',
        },
        {
          tmp_id: 'n2',
          parent_tmp_id: 'n1',
          name: 'Task moi',
          kind: 'work',
          effort_md: 1,
          role: 'Dev',
        },
      ],
      dependencies: [],
      ...over,
    };
  }

  function taskCount(): number {
    return (db.prepare('SELECT COUNT(*) n FROM task').get() as { n: number }).n;
  }

  describe('xem trước', () => {
    it('nói đúng số task sẽ thêm mà KHÔNG thêm gì', async () => {
      const before = taskCount();
      const res = await caller('U-PM').wbsImport.dryRun({ payload: payload() });

      expect(res.ok).toBe(true);
      if (res.ok) expect(res.tasksAdded).toBe(2);
      expect(taskCount()).toBe(before);
    });

    it('file hỏng thì trả về lý do kèm issue, không ném lỗi trần', async () => {
      const bad = payload({
        tasks: [{ tmp_id: 'x', parent_tmp_id: null, name: 'Khong co role', kind: 'work' }],
      });
      const res = await caller('U-PM').wbsImport.dryRun({ payload: bad });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/rejected/i);
      expect(taskCount()).toBe(2);
    });

    it('replace-subtree nói trước sẽ mất bao nhiêu task và bao nhiêu dòng tiến độ', async () => {
      const root = (db.prepare(`SELECT uid FROM task WHERE name='Root'`).get() as { uid: string })
        .uid;
      db.prepare(
        `INSERT INTO progress (task_uid,status,percent,updated_by,updated_at)
         VALUES ('T-0002','done',100,'U-PM',?)`,
      ).run(AT);

      const res = await caller('U-PM').wbsImport.dryRun({
        payload: payload({
          mode: 'replace-subtree',
          root_uid: root,
          tasks: [{ tmp_id: 'x', parent_uid: root, name: 'Thay the', kind: 'summary' }],
        }),
      });

      // Cây fixture: Root + A. `replace-subtree` xoá CON CHÁU của Root, tức mất A.
      expect(res.removing).toEqual({ taskCount: 1, progressRows: 1 });
      // Và vẫn chưa xoá gì thật.
      expect(taskCount()).toBe(2);
    });
  });

  describe('nạp thật', () => {
    it('thêm task và chạy validate luôn (§8 "sau mỗi lần import")', async () => {
      const res = await caller('U-PM').wbsImport.commit({ payload: payload() });
      expect(res.ok).toBe(true);
      expect(taskCount()).toBe(4);
      expect(await caller('U-PM').issues.lastRun({ projectId: 'P' })).toMatchObject({
        source: 'import',
      });
    });

    it('file hỏng thì DB không đổi', async () => {
      const before = taskCount();
      const res = await caller('U-PM').wbsImport.commit({
        payload: payload({
          tasks: [{ tmp_id: 'x', parent_tmp_id: null, name: 'Khong co role', kind: 'work' }],
        }),
      });
      expect(res.ok).toBe(false);
      expect(taskCount()).toBe(before);
    });
  });

  describe('quyền và đầu vào rác', () => {
    it('lead không được nạp — §10.6 cho `import_from_ai` chỉ PM', async () => {
      await expectTrpcCode(caller('U-LEAD').wbsImport.dryRun({ payload: payload() }), 'FORBIDDEN');
      await expectTrpcCode(caller('U-LEAD').wbsImport.commit({ payload: payload() }), 'FORBIDDEN');
    });

    it('người ngoài dự án cũng không', async () => {
      await expectTrpcCode(caller('U-OUT').wbsImport.dryRun({ payload: payload() }), 'FORBIDDEN');
    });

    it('quyền được kiểm TRƯỚC khi đụng tới nội dung file', async () => {
      // File sai schema hoàn toàn, nhưng `project_code` trỏ vào dự án mà lead không được
      // nạp: phải trả FORBIDDEN, không phải lỗi schema. Nếu ngược lại, người không có
      // quyền vẫn dò được cấu trúc file mà tool chấp nhận.
      await expectTrpcCode(
        caller('U-LEAD').wbsImport.dryRun({ payload: { project_code: 'UTG', rac: true } }),
        'FORBIDDEN',
      );
    });

    it('không phải object thì từ chối ngay', async () => {
      await expectTrpcCode(
        caller('U-PM').wbsImport.dryRun({ payload: 'day khong phai JSON object' }),
        'BAD_REQUEST',
      );
    });

    it('thiếu project_code thì nói rõ là thiếu cái gì', async () => {
      await expectTrpcCode(
        caller('U-PM').wbsImport.dryRun({ payload: { tasks: [] } }),
        'BAD_REQUEST',
      );
    });

    it('project_code không tồn tại thì NOT_FOUND', async () => {
      await expectTrpcCode(
        caller('U-PM').wbsImport.dryRun({ payload: payload({ project_code: 'KHONG-CO' }) }),
        'NOT_FOUND',
      );
    });
  });
});

// ── S7 — Chốt kỳ (§7.13) ────────────────────────────────────────────────────

describe('S7 — close period', () => {
  /** Fixture mặc định có task `work` chưa xếp lịch; chốt kỳ cần dữ liệu sạch. */
  function makeCleanable(): void {
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,actual_start,actual_end,updated_by,updated_at)
       VALUES ('T-0002','done',100,'2026-01-05','2026-01-06','U-PM',?)`,
    ).run(AT);
  }

  it('chốt được: đặt mốc chuẩn, sinh baseline, trả về số task đã chụp', async () => {
    makeCleanable();
    const res = await caller('U-PM').period.close({
      projectId: 'P',
      statusDate: '2026-02-01',
      label: 'Plan v1.0',
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.taskCount).toBeGreaterThan(0);
    expect(db.prepare(`SELECT status_date AS d FROM project WHERE id='P'`).get()).toEqual({
      d: '2026-02-01',
    });
    expect(db.prepare(`SELECT label FROM baseline WHERE project_id='P'`).get()).toEqual({
      label: 'Plan v1.0',
    });
  });

  it('có Critical thì KHÔNG chốt, và mốc chuẩn giữ nguyên', async () => {
    // `T-0002` là task `work` chưa có tiến độ — nhưng C04/C07 mới là thứ chặn. Bỏ role đi.
    db.prepare(`UPDATE task SET role = NULL WHERE uid = 'T-0002'`).run();
    const before = db.prepare(`SELECT status_date AS d FROM project WHERE id='P'`).get();

    const res = await caller('U-PM').period.close({
      projectId: 'P',
      statusDate: '2026-02-01',
      label: 'Plan v1.0',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.severity === 'Critical')).toBe(true);
    // §7.13 làm ba việc trong MỘT transaction: hỏng thì `status_date` cũng phải quay lại.
    expect(db.prepare(`SELECT status_date AS d FROM project WHERE id='P'`).get()).toEqual(before);
    expect(db.prepare(`SELECT COUNT(*) n FROM baseline`).get()).toEqual({ n: 0 });
  });

  it('lead không được chốt kỳ (§10.6)', async () => {
    await expectTrpcCode(
      caller('U-LEAD').period.close({
        projectId: 'P',
        statusDate: '2026-02-01',
        label: 'x',
      }),
      'FORBIDDEN',
    );
  });

  it('liệt kê baseline, mới nhất trước', async () => {
    makeCleanable();
    await caller('U-PM').period.close({
      projectId: 'P',
      statusDate: '2026-02-01',
      label: 'Plan v1.0',
    });
    const list = await caller('U-PM').period.list({ projectId: 'P' });
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe('Plan v1.0');
  });

  it('lead ĐỌC được danh sách baseline — xem không phải là chốt', async () => {
    const list = await caller('U-LEAD').period.list({ projectId: 'P' });
    expect(list).toEqual([]);
  });
});

/**
 * S2 — Task detail (quyết định 2026-09-14).
 *
 * PM chốt: S2 sửa được nhóm nhãn phân loại, mọi thứ khác chỉ đọc.
 */
describe('S2 — task detail', () => {
  it('detail gom đúng những gì lớp MCP trả về', async () => {
    const out = await caller('U-PM').wbs.detail({ taskUid: 'T-0002' });

    expect(out.task.name).toBe('A');
    expect(out.task.phase).toBe('P1');
    expect(out.task.assigneeName).toBe('Dev');
    expect(out.dependencies).toHaveProperty('predecessors');
    expect(out.dependencies).toHaveProperty('successors');
    // Chuỗi chặn: chưa xếp lịch thì chỉ có chính nó, và KHÔNG được ném.
    expect(out.explanation.chain.length).toBeGreaterThan(0);
  });

  /**
   * Summary KHÔNG có dòng `schedule` — ngày và MD của nó là rollup từ con (§7.7).
   *
   * Lỗi đã thấy tận mắt trên trình duyệt: panel hiện "—" cho một summary trong khi dòng
   * cây ngay bên trái hiện ngày thật. Cùng một task, hai câu trả lời — và không test nào
   * lúc đó thấy, vì tất cả đều hỏi task lá.
   */
  it('summary lấy ngày và MD từ rollup, không phải null', async () => {
    const root = await caller('U-PM').wbs.detail({ taskUid: 'T-0001' });
    expect(root.task.kind).toBe('summary');

    const tree = await caller('U-PM').wbs.tree({ projectId: 'P' });
    const rootRow = tree.find((r) => r.uid === 'T-0001');

    // Phải khớp ĐÚNG giá trị cây hiện, không phải "một giá trị nào đó khác null".
    expect(root.task.startDate).toBe(rootRow?.planStart ?? null);
    expect(root.task.endDate).toBe(rootRow?.planEnd ?? null);
    expect(root.task.effortMd).toBe(rootRow?.effortMd ?? null);
    expect(root.task.percent).toBe(rootRow?.percent);
  });

  it('task không tồn tại thì NOT_FOUND', async () => {
    await expectTrpcCode(caller('U-PM').wbs.detail({ taskUid: 'T-KHONG-CO' }), 'NOT_FOUND');
  });

  it('người ngoài dự án không đọc được', async () => {
    await expectTrpcCode(caller('U-OUT').wbs.detail({ taskUid: 'T-0002' }), 'FORBIDDEN');
  });

  it('sửa được nhóm nhãn, có ghi nhật ký', async () => {
    const res = await caller('U-PM').wbs.updateLabels({
      taskUid: 'T-0002',
      description: 'Mô tả dài',
      category: 'dev',
      phase: 'P2',
      module: 'mod-2',
      externalRef: 'JIRA-1',
    });
    expect(res.ok).toBe(true);
    expect(res.validation.projectId).toBe('P');

    const after = await caller('U-PM').wbs.detail({ taskUid: 'T-0002' });
    expect(after.task.phase).toBe('P2');
    expect(after.task.module).toBe('mod-2');
    expect(after.task.category).toBe('dev');

    expect(historyOf(db, 'task', 'T-0002').length).toBeGreaterThan(0);
  });

  /**
   * Chuỗi rỗng phải quy về `NULL`.
   *
   * `phase = ''` và `phase = NULL` khác nhau với SQL nhưng cùng nghĩa "chưa đặt" với
   * người dùng, và `N03` chỉ kiểm `NULL`. Không quy về thì xoá trắng một ô sẽ làm rule
   * im lặng trong khi dữ liệu vẫn thiếu — một lỗi không ai nhìn thấy.
   */
  it('xoá trắng một ô thì lưu NULL, không lưu chuỗi rỗng', async () => {
    await caller('U-PM').wbs.updateLabels({
      taskUid: 'T-0002',
      description: '   ',
      category: '',
      phase: '',
      module: '',
      externalRef: '',
    });

    const row = db.prepare('SELECT * FROM task WHERE uid = ?').get('T-0002') as Record<
      string,
      unknown
    >;
    for (const col of ['description', 'category', 'phase', 'module', 'external_ref']) {
      expect(row[col], `${col} phải là NULL`).toBeNull();
    }
  });

  /**
   * Vòng tròn khép kín của cả màn hình này: `N03` báo thiếu `phase`/`module`, PM sửa ở
   * S2, issue biến mất. Trước S2 thì bước giữa KHÔNG tồn tại — đó là lý do màn này có
   * mặt (xem `docs/decisions/2026-09-14-s2-pham-vi.md`).
   */
  it('vá được N03: báo lỗi → sửa ở S2 → hết lỗi', async () => {
    const n03 = (report: { issues: ReadonlyArray<{ code: string; taskUid?: string }> }): number =>
      report.issues.filter((i) => i.code === 'N03' && i.taskUid === 'T-0002').length;

    const cleared = await caller('U-PM').wbs.updateLabels({
      taskUid: 'T-0002',
      description: null,
      category: null,
      phase: null,
      module: null,
      externalRef: null,
    });
    expect(n03(cleared.validation), 'gỡ phase/module thì N03 phải kêu').toBe(1);

    const fixed = await caller('U-PM').wbs.updateLabels({
      taskUid: 'T-0002',
      description: null,
      category: null,
      phase: 'P1',
      module: 'mod-1',
      externalRef: null,
    });
    expect(n03(fixed.validation), 'đặt lại thì N03 phải im').toBe(0);
  });

  it('lead không sửa được nhãn (§10.6 — edit_wbs là của PM)', async () => {
    await expectTrpcCode(
      caller('U-LEAD').wbs.updateLabels({
        taskUid: 'T-0002',
        description: null,
        category: null,
        phase: 'X',
        module: 'Y',
        externalRef: null,
      }),
      'FORBIDDEN',
    );
  });

  /** Hai nhóm sửa ở hai màn khác nhau, không được ghi đè lẫn nhau. */
  it('sửa nhãn KHÔNG đụng tới name/effort/role/priority của S1', async () => {
    await caller('U-PM').wbs.updateTask({
      taskUid: 'T-0002',
      name: 'Tên từ S1',
      effortMd: 7,
      role: 'Dev',
      priority: 100,
    });
    await caller('U-PM').wbs.updateLabels({
      taskUid: 'T-0002',
      description: null,
      category: null,
      phase: 'P9',
      module: 'mod-9',
      externalRef: null,
    });

    const out = await caller('U-PM').wbs.detail({ taskUid: 'T-0002' });
    expect(out.task.name).toBe('Tên từ S1');
    expect(out.task.effortMd).toBe(7);
    expect(out.task.priority).toBe(100);
    expect(out.task.phase).toBe('P9');
  });
});
