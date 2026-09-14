/**
 * Tool ghi của lớp MCP — SPEC.md §12.2, quy tắc §12.4.
 *
 * Bốn thứ phải đúng ở đây, và không thứ nào trong số đó là "hàm chạy không lỗi":
 *
 *   1. Quyền §10.6 chặn được, kể cả khi không có nút nào để ẩn.
 *   2. `audit_log` ghi lại AI đã đổi gì — nếu không thì thao tác AI không truy nguyên được.
 *   3. `ValidationReport` đi kèm mọi thao tác ghi (§12.4).
 *   4. Lỗi thì ROLLBACK, không để lại nửa vời.
 *
 * Đi qua HTTP như client thật, không gọi thẳng hàm.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { createMcpToken } from '@planix/core/db/repo/mcp-token-repo.js';
import { createApp } from '../src/http/app.js';
import { silentSink } from '../src/http/request-log.js';

const AT = '2026-09-14T09:00:00.000Z';

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof createApp>;
let pmToken: string;
let viewerToken: string;

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
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev An','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-2','Dev Binh','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-2','Dev')`).run();

  for (const [id, email] of [
    ['U-PM', 'pm@x.com'],
    ['U-VIEW', 'view@x.com'],
  ]) {
    db.prepare(
      `INSERT INTO app_user (id,email,name,password_hash,is_admin,created_at)
       VALUES (?,?,?,'x',0,?)`,
    ).run(id, email, id, AT);
  }
  db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P','pm')`).run();
  // `viewer` xem được nhưng KHÔNG sửa được (§10.6) — đó là điều kiện để kiểm, không phải
  // người dùng thừa.
  db.prepare(
    `INSERT INTO user_project (user_id,project_id,role) VALUES ('U-VIEW','P','viewer')`,
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
          name: 'Design',
          kind: 'work',
          effort_md: 2,
          role: 'Dev',
        },
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'Build', kind: 'work', effort_md: 3, role: 'Dev' },
        { tmp_id: 'c', parent_tmp_id: 'b', name: 'Sub', kind: 'work', effort_md: 1, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );

  pmToken = createMcpToken(db, { userId: 'U-PM', label: 'pm', now: AT }).token;
  viewerToken = createMcpToken(db, { userId: 'U-VIEW', label: 'viewer', now: AT }).token;
  app = createApp({ db, dbPath: ':memory:', enableHsts: true, now: () => AT, log: silentSink });
});
afterEach(() => db.close());

let rpcId = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
  token: string = pmToken,
): Promise<{ isError: boolean; result: Record<string, unknown>; text: string }> {
  rpcId += 1;
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as {
    result?: {
      isError?: boolean;
      structuredContent?: { result: Record<string, unknown> };
      content: Array<{ text: string }>;
    };
    error?: { message: string };
  };
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  const r = body.result;
  if (r === undefined) throw new Error('no result');
  return {
    isError: r.isError === true,
    result: r.structuredContent?.result ?? {},
    text: r.content[0]?.text ?? '',
  };
}

function uidOf(name: string): string {
  const r = db.prepare('SELECT uid FROM task WHERE name = ?').get(name) as
    { uid: string } | undefined;
  if (r === undefined) throw new Error(`no task ${name}`);
  return r.uid;
}

const countTasks = (): number =>
  (db.prepare('SELECT COUNT(*) n FROM task').get() as { n: number }).n;
const auditRows = (entityId: string): Array<Record<string, unknown>> =>
  db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(entityId) as Array<
    Record<string, unknown>
  >;

describe('§12.4 — ba quy tắc quanh mọi tool ghi', () => {
  it('kèm ValidationReport sau khi ghi', async () => {
    const res = await callTool('wbs_update_task', {
      uid: uidOf('Design'),
      name: 'Design v2',
      effort_md: 4,
      role: 'Dev',
      priority: 100,
    });
    expect(res.isError).toBe(false);
    const report = res.result['validation'] as { projectId: string; counts: unknown } | null;
    expect(report?.projectId).toBe('P');
    expect(report?.counts).toBeDefined();
  });

  /**
   * Báo cáo phải phản ánh trạng thái SAU khi ghi, không phải trước.
   *
   * Đó là cả điểm của §12.4: AI cần biết thao tác nó vừa làm để lại dự án ở tình trạng
   * nào. Chụp trước khi ghi thì báo cáo luôn "sạch" ngay cả khi vừa tạo ra lỗi.
   */
  it('báo cáo phản ánh trạng thái SAU khi ghi', async () => {
    // Đặt effort âm không được (schema chặn), nên tạo lỗi bằng cách khác: gỡ role khỏi
    // task, không ai đảm nhiệm được ⇒ sinh issue.
    const before = await callTool('wbs_validate', { project: 'UTG' });
    const beforeCount = (before.result as unknown as { counts: { critical: number } }).counts
      .critical;

    const res = await callTool('wbs_update_task', {
      uid: uidOf('Design'),
      name: 'Design',
      effort_md: 2,
      role: 'KhongAiLamDuoc',
      priority: 500,
    });
    const after = (res.result['validation'] as { counts: { critical: number } }).counts.critical;
    expect(after).toBeGreaterThan(beforeCount);
  });

  it('ghi audit_log — thao tác AI phải truy nguyên được', async () => {
    const uid = uidOf('Design');
    expect(auditRows(uid)).toHaveLength(0);

    await callTool('wbs_update_task', {
      uid,
      name: 'Design đổi tên',
      effort_md: 2,
      role: 'Dev',
      priority: 500,
    });

    const rows = auditRows(uid);
    expect(rows.length).toBeGreaterThan(0);
    // Phải ghi ĐÚNG người đứng sau token, không phải một principal vô danh.
    expect(rows[0]?.['user_id']).toBe('U-PM');
  });
});

describe('§10.6 — quyền chặn ở server', () => {
  it('viewer KHÔNG sửa được, và dữ liệu không đổi', async () => {
    const uid = uidOf('Design');
    const res = await callTool(
      'wbs_update_task',
      { uid, name: 'Viewer sửa trộm', effort_md: 9, role: 'Dev', priority: 1 },
      viewerToken,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain('FORBIDDEN');

    const row = db.prepare('SELECT name FROM task WHERE uid = ?').get(uid) as { name: string };
    expect(row.name).toBe('Design');
  });

  it('viewer không xoá được cây', async () => {
    const before = countTasks();
    const res = await callTool(
      'wbs_delete_subtree',
      { uid: uidOf('Build'), confirm: true },
      viewerToken,
    );
    expect(res.isError).toBe(true);
    expect(countTasks()).toBe(before);
  });
});

describe('wbs_delete_subtree — hai lượt (§12.2)', () => {
  /**
   * §12.2: "trả về số task sẽ mất, cần confirm".
   *
   * Không phải hình thức. Dữ liệu demo đã từng mất 20 task vì một lệnh replace-subtree
   * không ai xác nhận, và không có lệnh hoàn tác.
   */
  it('không confirm thì CHỈ xem trước, không xoá gì', async () => {
    const before = countTasks();
    const res = await callTool('wbs_delete_subtree', { uid: uidOf('Build') });

    expect(res.isError).toBe(false);
    expect(res.result['ok']).toBe(false);
    expect(res.result['confirmRequired']).toBe(true);
    expect(res.result['wouldDelete']).toBeDefined();
    expect(countTasks()).toBe(before);
  });

  it('bỏ hẳn tham số confirm cũng KHÔNG xoá — mặc định là an toàn', async () => {
    const before = countTasks();
    await callTool('wbs_delete_subtree', { uid: uidOf('Build') });
    expect(countTasks()).toBe(before);
  });

  it('confirm true thì xoá cả nhánh con', async () => {
    const before = countTasks();
    const res = await callTool('wbs_delete_subtree', { uid: uidOf('Build'), confirm: true });

    expect(res.isError).toBe(false);
    // Build + Sub
    expect(countTasks()).toBe(before - 2);
    expect(res.result['validation']).toBeDefined();
  });
});

describe('wbs_import — dry run mặc định', () => {
  /**
   * Gắn vào gốc SẴN CÓ bằng `parent_uid`.
   *
   * `parent_tmp_id: null` nghĩa là "gốc của chính file này" và sẽ tạo gốc THỨ HAI trong
   * dự án ⇒ dính `C08` ⇒ cả file bị từ chối. Bản đầu tôi viết đúng kiểu đó và mất một
   * lúc mới hiểu vì sao "import thành công" mà không có task nào được thêm.
   */
  function payloadUnder(rootUid: string): Record<string, unknown> {
    return {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        {
          tmp_id: 'x',
          parent_uid: rootUid,
          name: 'Task mới',
          kind: 'work',
          effort_md: 1,
          role: 'Dev',
        },
      ],
      dependencies: [],
    };
  }

  it('mặc định là dry run và KHÔNG ghi gì', async () => {
    const before = countTasks();
    const res = await callTool('wbs_import', { payload: payloadUnder(uidOf('Root')) });

    expect(res.isError).toBe(false);
    expect(res.result['dryRun']).toBe(true);
    expect(res.result['ok']).toBe(false);
    expect(countTasks()).toBe(before);
  });

  it('dry_run false thì ghi thật', async () => {
    const before = countTasks();
    const res = await callTool('wbs_import', {
      payload: payloadUnder(uidOf('Root')),
      dry_run: false,
    });

    expect(res.isError).toBe(false);
    expect(res.result['ok'], JSON.stringify(res.result)).toBe(true);
    expect(countTasks()).toBeGreaterThan(before);
  });

  /**
   * File bị TỪ CHỐI không được báo `ok: true`.
   *
   * `wbsImport.commit` trả `{ ok: false, issues }` chứ không ném — cố ý, vì danh sách
   * issue mới là thứ cần đọc. Bản đầu của `write-tools.ts` gán cứng `ok: true` quanh nó,
   * nên tool báo THÀNH CÔNG cho một lần import không ghi gì. Test này đếm số task chứ
   * không chỉ kiểm `isError`, nên nó bắt được.
   */
  it('file bị từ chối thì ok = false, không phải true', async () => {
    const before = countTasks();
    const twoRoots = {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        {
          tmp_id: 'y',
          parent_tmp_id: null,
          name: 'Gốc thứ hai',
          kind: 'work',
          effort_md: 1,
          role: 'Dev',
        },
      ],
      dependencies: [],
    };

    const res = await callTool('wbs_import', { payload: twoRoots, dry_run: false });
    expect(res.result['ok'], JSON.stringify(res.result).slice(0, 300)).toBe(false);
    expect(countTasks()).toBe(before);
  });

  /** Payload sai schema: báo không thành công và không để lại gì (§9.2). */
  it('payload hỏng thì không để lại gì', async () => {
    const before = countTasks();
    const res = await callTool('wbs_import', {
      payload: { version: '1.0', project_code: 'UTG', mode: 'merge', tasks: [{ bad: true }] },
      dry_run: false,
    });
    expect(res.result['ok']).toBe(false);
    expect(countTasks()).toBe(before);
  });
});

describe('wbs_pin_resource', () => {
  it('ghim rồi gỡ, có ghi audit', async () => {
    const uid = uidOf('Design');
    const res = await callTool('wbs_pin_resource', { task_uid: uid, resource_id: 'R-1' });
    expect(res.isError).toBe(false);

    const pinned = db.prepare('SELECT pinned_resource p FROM task WHERE uid = ?').get(uid) as {
      p: string | null;
    };
    expect(pinned.p).toBe('R-1');
    expect(auditRows(uid).length).toBeGreaterThan(0);

    await callTool('wbs_pin_resource', { task_uid: uid, resource_id: null });
    const after = db.prepare('SELECT pinned_resource p FROM task WHERE uid = ?').get(uid) as {
      p: string | null;
    };
    expect(after.p).toBeNull();
  });

  /** Ghim vào người không tồn tại phải báo lỗi, không ghi một FK treo. */
  it('người không tồn tại thì từ chối', async () => {
    const uid = uidOf('Design');
    const res = await callTool('wbs_pin_resource', { task_uid: uid, resource_id: 'R-KHONG-CO' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('NOT_FOUND');

    const row = db.prepare('SELECT pinned_resource p FROM task WHERE uid = ?').get(uid) as {
      p: string | null;
    };
    expect(row.p).toBeNull();
  });

  it('viewer không ghim được', async () => {
    const res = await callTool(
      'wbs_pin_resource',
      { task_uid: uidOf('Design'), resource_id: 'R-1' },
      viewerToken,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain('FORBIDDEN');
  });
});

describe('wbs_set_progress', () => {
  it('lưu tiến độ và kèm báo cáo', async () => {
    const uid = uidOf('Design');
    const res = await callTool('wbs_set_progress', {
      task_uid: uid,
      status: 'in_progress',
      percent: 40,
    });
    expect(res.isError).toBe(false);
    expect(res.result['validation']).toBeDefined();

    const row = db.prepare('SELECT status, percent FROM progress WHERE task_uid = ?').get(uid) as {
      status: string;
      percent: number;
    };
    expect(row.status).toBe('in_progress');
    expect(row.percent).toBe(40);
  });

  it("status 'done' tự hiểu là 100%", async () => {
    const uid = uidOf('Design');
    // §10.5 đòi `done` phải có ngày kết thúc thật — nếu không thì EVM không có gì để đo.
    const res = await callTool('wbs_set_progress', {
      task_uid: uid,
      status: 'done',
      actual_start: '2026-01-05',
      actual_end: '2026-01-06',
    });
    expect(res.isError, res.text).toBe(false);

    const row = db.prepare('SELECT percent FROM progress WHERE task_uid = ?').get(uid) as {
      percent: number;
    };
    expect(row.percent).toBe(100);
  });

  /** `done` mà thiếu ngày kết thúc thật thì tầng dưới từ chối — và MCP phải chuyển đúng. */
  it("'done' thiếu actual_end thì bị từ chối", async () => {
    const res = await callTool('wbs_set_progress', { task_uid: uidOf('Design'), status: 'done' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('actual end date');
  });

  /**
   * `in_progress` mà thiếu `percent` thì TỪ CHỐI, không đoán.
   *
   * Bịa ra 50% rồi để nó chảy vào EVM là làm hỏng chính thước đo (§7.13) — và sai kiểu
   * đó không ai phát hiện được, vì con số trông vẫn hợp lý.
   */
  it('in_progress thiếu percent thì từ chối, không đoán', async () => {
    const res = await callTool('wbs_set_progress', {
      task_uid: uidOf('Design'),
      status: 'in_progress',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('percent is required');
  });
});

describe('wbs_set_dependency', () => {
  it('nối rồi gỡ được', async () => {
    const design = uidOf('Design');
    const sub = uidOf('Sub');
    const res = await callTool('wbs_set_dependency', { pred: design, succ: sub, type: 'FS' });
    expect(res.isError).toBe(false);

    const n = db
      .prepare('SELECT COUNT(*) n FROM dependency WHERE pred_uid=? AND succ_uid=?')
      .get(design, sub) as { n: number };
    expect(n.n).toBe(1);

    await callTool('wbs_delete_dependency', { pred: design, succ: sub, type: 'FS' });
    const after = db
      .prepare('SELECT COUNT(*) n FROM dependency WHERE pred_uid=? AND succ_uid=?')
      .get(design, sub) as { n: number };
    expect(after.n).toBe(0);
  });

  /**
   * Vòng lặp KHÔNG bị chặn ở đường ghi — nó được ghi rồi báo `C01` Critical.
   *
   * Bản đầu tôi viết test này kỳ vọng ngược lại và nó đỏ. Hành vi thật mới là đúng:
   * N4 (§2) nói engine không tự phá ràng buộc, xung đột thì SINH ISSUE chứ không tự sửa;
   * và §12.4 cho tool ghi thực hiện xong rồi kèm báo cáo. Chặn giữa chừng sẽ khoá PM lại
   * giữa một chuỗi sửa nhiều bước mà mọi trạng thái trung gian đều tạm thời sai.
   *
   * Thứ phải đúng là báo cáo NÓI RA: `C01` mức Critical, `passed: false`.
   */
  it('tạo vòng thì vẫn ghi, nhưng báo cáo phải nói C01 Critical', async () => {
    const design = uidOf('Design');
    const build = uidOf('Build');

    const res = await callTool('wbs_set_dependency', { pred: build, succ: design, type: 'FS' });
    expect(res.isError).toBe(false);

    const report = res.result['validation'] as {
      passed: boolean;
      counts: { critical: number };
      issues: Array<{ code: string; severity: string }>;
    };
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.code === 'C01' && i.severity === 'Critical')).toBe(true);
  });
});

describe('uid không tồn tại', () => {
  it('mọi tool ghi đều báo NOT_FOUND thay vì ném ra ngoài', async () => {
    for (const [name, args] of [
      ['wbs_update_task', { uid: 'T-KHONG-CO', name: 'x', effort_md: 1, role: 'Dev', priority: 1 }],
      ['wbs_move_task', { uid: 'T-KHONG-CO', new_parent_uid: null, new_sort_order: 0 }],
      ['wbs_delete_subtree', { uid: 'T-KHONG-CO', confirm: true }],
      ['wbs_set_sequencing', { summary_uid: 'T-KHONG-CO', mode: 'parallel' }],
      ['wbs_set_progress', { task_uid: 'T-KHONG-CO', status: 'done' }],
      ['wbs_pin_resource', { task_uid: 'T-KHONG-CO', resource_id: null }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(name, args);
      expect(res.isError, `${name} phải báo lỗi`).toBe(true);
      expect(res.text, `${name} phải nói NOT_FOUND`).toContain('NOT_FOUND');
    }
  });
});

describe('danh sách tool', () => {
  it('đủ bộ ghi §12.2', async () => {
    rpcId += 1;
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method: 'tools/list', params: {} }),
    });
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    for (const required of [
      'wbs_import',
      'wbs_update_task',
      'wbs_move_task',
      'wbs_delete_subtree',
      'wbs_set_dependency',
      'wbs_set_sequencing',
      'wbs_pin_resource',
      'wbs_set_progress',
    ]) {
      expect(names, `thiếu ${required}`).toContain(required);
    }
  });
});
