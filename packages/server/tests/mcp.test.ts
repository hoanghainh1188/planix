/**
 * Lớp MCP — SPEC.md §12.
 *
 * Test đi qua ĐÚNG đường mà một client MCP thật đi: HTTP POST `/mcp` với bearer token,
 * body JSON-RPC. Gọi thẳng `createMcpServer()` sẽ xanh kể cả khi route quên kiểm tra
 * token — tức là đúng chỗ duy nhất ở đây có thể hỏng nghiêm trọng thì không được kiểm.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import {
  createMcpToken,
  listMcpTokens,
  resolveMcpToken,
  revokeMcpToken,
} from '@planix/core/db/repo/mcp-token-repo.js';
import { createApp } from '../src/http/app.js';
import { silentSink, type RequestLogEntry } from '../src/http/request-log.js';
import { bearerToken } from '../src/http/mcp.js';
import { SESSION_COOKIE } from '../src/auth/session.js';

const AT = '2026-09-13T09:00:00.000Z';

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof createApp>;
let pmToken: string;
let outsiderToken: string;

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

  for (const [id, email] of [
    ['U-PM', 'pm@x.com'],
    ['U-OUT', 'out@x.com'],
  ]) {
    db.prepare(
      `INSERT INTO app_user (id,email,name,password_hash,is_admin,created_at)
       VALUES (?,?,?,'x',0,?)`,
    ).run(id, email, id, AT);
  }
  // Chỉ PM được gán vào dự án. `U-OUT` tồn tại nhưng không có vai — đó là điều kiện để
  // kiểm bảng §10.6, không phải người dùng thừa.
  db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P','pm')`).run();

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
          phase: 'design',
        },
        {
          tmp_id: 'b',
          parent_tmp_id: 'r',
          name: 'Build',
          kind: 'work',
          effort_md: 3,
          role: 'Dev',
          phase: 'build',
        },
        // Đủ con để sinh mã hai chữ số. `1.10` là lý do rule tiền tố phải có dấu chấm:
        // thiếu nó thì lọc "1.1" trả về cả nhánh này.
        ...Array.from({ length: 8 }, (_, i) => ({
          tmp_id: `f${String(i)}`,
          parent_tmp_id: 'r',
          name: `Filler ${String(i)}`,
          kind: 'work' as const,
          effort_md: 1,
          role: 'Dev',
        })),
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );

  pmToken = createMcpToken(db, { userId: 'U-PM', label: 'claude', now: AT }).token;
  outsiderToken = createMcpToken(db, { userId: 'U-OUT', label: 'nobody', now: AT }).token;

  app = createApp({ db, dbPath: ':memory:', enableHsts: true, now: () => AT, log: silentSink });
});
afterEach(() => db.close());

let rpcId = 0;

/** Một lời gọi JSON-RPC tới `/mcp`. `token === null` = không gửi header nào. */
async function rpc(
  method: string,
  params: unknown,
  token: string | null = pmToken,
): Promise<Response> {
  rpcId += 1;
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Giao thức đòi client nói rõ nó nhận được cả hai kiểu.
      accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
  });
}

/** Gọi một tool và trả về phần JSON có cấu trúc mà §12.4 đòi hỏi. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  token: string | null = pmToken,
): Promise<{ isError: boolean; result: unknown; text: string }> {
  const res = await rpc('tools/call', { name, arguments: args }, token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: {
      isError?: boolean;
      structuredContent?: { result: unknown };
      content: Array<{ text: string }>;
    };
    error?: unknown;
  };
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  const r = body.result;
  if (r === undefined) throw new Error('no result');
  return {
    isError: r.isError === true,
    result: r.structuredContent?.result,
    text: r.content[0]?.text ?? '',
  };
}

/** Gọi một tool có phân trang và lấy ra phần `tasks`. */
async function tasksOf(
  name: string,
  args: Record<string, unknown>,
  token: string | null = pmToken,
): Promise<Array<Record<string, unknown>>> {
  const res = await callTool(name, args, token);
  return (res.result as { tasks: Array<Record<string, unknown>> }).tasks;
}

describe('token (§12.4)', () => {
  it('cấp rồi tra lại ra đúng người', () => {
    const created = createMcpToken(db, { userId: 'U-PM', label: 'ci', now: AT });
    expect(created.token.startsWith('planix_mcp_')).toBe(true);

    const principal = resolveMcpToken(db, created.token, AT);
    expect(principal).toEqual({ tokenId: created.id, userId: 'U-PM', isAdmin: false });
  });

  it('KHÔNG lưu bản rõ ở bất cứ cột nào', () => {
    const created = createMcpToken(db, { userId: 'U-PM', label: 'ci', now: AT });
    const row = db.prepare('SELECT * FROM mcp_token WHERE id = ?').get(created.id) as Record<
      string,
      unknown
    >;
    for (const value of Object.values(row)) {
      expect(String(value)).not.toContain(created.token);
    }
  });

  it('token sai, sai tiền tố, hay đã thu hồi đều trả null', () => {
    const created = createMcpToken(db, { userId: 'U-PM', label: 'ci', now: AT });
    expect(resolveMcpToken(db, 'planix_mcp_khong-co-that', AT)).toBeNull();
    expect(resolveMcpToken(db, created.token.replace('planix_mcp_', 'other_'), AT)).toBeNull();

    expect(revokeMcpToken(db, created.id, AT)).toBe(1);
    expect(resolveMcpToken(db, created.token, AT)).toBeNull();
    // Thu hồi hai lần không đổi gì thêm — `revoked_at` giữ nguyên lần đầu.
    expect(revokeMcpToken(db, created.id, '2027-01-01T00:00:00.000Z')).toBe(0);
  });

  it('ghi lại lần dùng gần nhất', () => {
    const created = createMcpToken(db, { userId: 'U-PM', label: 'ci', now: AT });
    const before = listMcpTokens(db).find((t) => t.id === created.id);
    expect(before?.lastUsedAt).toBeNull();

    resolveMcpToken(db, created.token, '2026-09-14T10:00:00.000Z');
    const after = listMcpTokens(db).find((t) => t.id === created.id);
    expect(after?.lastUsedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('bearerToken chỉ nhận đúng dạng', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('  Bearer abc  ')).toBe('abc');
    expect(bearerToken('bearer abc')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('endpoint (§12.4)', () => {
  it('không có token thì 401', async () => {
    const res = await rpc('tools/list', {}, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('token đã thu hồi thì 401', async () => {
    const created = createMcpToken(db, { userId: 'U-PM', label: 'ci', now: AT });
    revokeMcpToken(db, created.id, AT);
    expect((await rpc('tools/list', {}, created.token)).status).toBe(401);
  });

  /**
   * §12.4 nói "không dùng session cookie". Một phiên hợp lệ mà KHÔNG có bearer token vẫn
   * phải bị từ chối — nếu không thì `/mcp` thành một endpoint ghi mở cho CSRF.
   */
  it('cookie phiên hợp lệ KHÔNG mở được endpoint', async () => {
    db.prepare(
      `INSERT INTO session (id,user_id,created_at,expires_at) VALUES ('S1','U-PM',?,?)`,
    ).run(AT, '2030-01-01T00:00:00.000Z');

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        cookie: `${SESSION_COOKIE}=S1`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('ghi userId vào nhật ký request', async () => {
    const entries: RequestLogEntry[] = [];
    const logged = createApp({
      db,
      dbPath: ':memory:',
      enableHsts: true,
      now: () => AT,
      log: (e) => entries.push(e),
    });
    await logged.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(entries.at(-1)?.userId).toBe('U-PM');
    expect(entries.at(-1)?.path).toBe('/mcp');
  });

  /**
   * So khớp CHÍNH XÁC, không phải "có chứa".
   *
   * Danh sách tool là bề mặt API của lớp này. Thêm nhầm một tool hay gỡ mất một tool đều
   * là thay đổi hợp đồng với mọi client, và kiểu "có chứa" sẽ không thấy cái nào cả.
   */
  it('liệt kê đúng bộ tool §12.1, §12.2 và §12.3 — đủ, không thừa', async () => {
    const res = await rpc('tools/list', {});
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(
      [
        // §12.1 — đọc
        'wbs_explain_task',
        'wbs_get_critical_path',
        'wbs_get_schedule',
        'wbs_get_task',
        'wbs_get_tree',
        'wbs_list_projects',
        'wbs_list_tasks',
        'wbs_validate',
        'wbs_get_resource_load',
        'wbs_diff_baseline',
        'wbs_list_baselines',
        // §12.2 — ghi
        'wbs_delete_dependency',
        'wbs_delete_subtree',
        'wbs_import',
        'wbs_move_task',
        'wbs_pin_resource',
        'wbs_set_dependency',
        'wbs_set_progress',
        'wbs_set_sequencing',
        'wbs_update_task',
        // §12.3 — chạy. `wbs_what_if` KHÔNG có ở đây: nó thuộc P14 theo §14.1.
        'wbs_close_period',
        'wbs_export_excel',
        'wbs_schedule',
      ].sort(),
    );
  });
});

describe('tool đọc (§12.1)', () => {
  it('wbs_list_projects chỉ trả dự án của chính người đó', async () => {
    const mine = await callTool('wbs_list_projects', {});
    expect(mine.result).toHaveLength(1);

    const theirs = await callTool('wbs_list_projects', {}, outsiderToken);
    expect(theirs.result).toHaveLength(0);
  });

  /** §10.6: chặn ở server. MCP không có nút để ẩn, nên đây là lớp duy nhất. */
  it('người ngoài dự án bị từ chối, không phải trả về rỗng', async () => {
    const res = await callTool('wbs_get_tree', { project: 'UTG' }, outsiderToken);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Not allowed');
  });

  it('nhận cả mã dự án lẫn id', async () => {
    const byCode = await callTool('wbs_get_tree', { project: 'UTG' });
    const byId = await callTool('wbs_get_tree', { project: 'P' });
    expect(byId.result).toEqual(byCode.result);
  });

  it('dự án không tồn tại thì báo lỗi, không ném ra ngoài', async () => {
    const res = await callTool('wbs_get_tree', { project: 'KHONG-CO' });
    expect(res.isError).toBe(true);
  });

  it('wbs_get_tree cắt theo root_uid và max_depth', async () => {
    const all = await tasksOf('wbs_get_tree', { project: 'UTG' });
    expect(all).toHaveLength(11);

    const root = all.find((t) => t['wbsCode'] === '1');
    expect(await tasksOf('wbs_get_tree', { project: 'UTG', root_uid: root?.['uid'] })).toHaveLength(
      11,
    ); // gốc + mười con
    expect(await tasksOf('wbs_get_tree', { project: 'UTG', max_depth: 1 })).toHaveLength(1);
  });

  /**
   * `root_uid` bám chuỗi CHA, không so tiền tố `wbs_code`. Cả hai cách cho cùng kết quả
   * trên cây này, nên phải kiểm bằng một task KHÔNG phải hậu duệ nhưng có mã trùng tiền
   * tố — đó là trường hợp cách sai sẽ lọt.
   */
  it('wbs_get_tree không nhầm tiền tố mã với quan hệ cha con', async () => {
    const all = await tasksOf('wbs_get_tree', { project: 'UTG' });
    const first = all.find((t) => t['wbsCode'] === '1.1');
    const sub = await tasksOf('wbs_get_tree', { project: 'UTG', root_uid: first?.['uid'] });
    expect(sub.map((t) => t['wbsCode'])).toEqual(['1.1']);
  });

  it('wbs_list_tasks lọc theo phase và trạng thái', async () => {
    const design = await tasksOf('wbs_list_tasks', { project: 'UTG', phase: 'design' });
    expect(design.map((t) => t['name'])).toEqual(['Design']);
    expect(await tasksOf('wbs_list_tasks', { project: 'UTG', status: 'done' })).toHaveLength(0);
  });

  it('wbs_list_tasks: tiền tố "1.1" không nuốt "1.10"', async () => {
    const codes = (await tasksOf('wbs_get_tree', { project: 'UTG' })).map((t) => t['wbsCode']);
    // Không có `1.10` thì test này không phân biệt được gì — nó phải tồn tại thật.
    expect(codes).toContain('1.10');

    const hit = await tasksOf('wbs_list_tasks', { project: 'UTG', wbs_prefix: '1.1' });
    expect(hit.map((t) => t['wbsCode'])).toEqual(['1.1']);
  });

  /**
   * Đo trên fixture 6.000 task: `wbs_get_tree` không giới hạn sinh 3,9 MB JSON, khoảng
   * một triệu token. Cắt trang là bắt buộc — nhưng cắt LẶNG LẼ còn tệ hơn không cắt.
   */
  it('phân trang và nói rõ là đã cắt', async () => {
    const full = (await callTool('wbs_get_tree', { project: 'UTG' })).result as {
      total: number;
      returned: number;
      truncated: boolean;
    };
    expect(full.total).toBe(11);
    expect(full.returned).toBe(11);
    expect(full.truncated).toBe(false);

    const first = (await callTool('wbs_get_tree', { project: 'UTG', limit: 4 })).result as {
      total: number;
      offset: number;
      returned: number;
      truncated: boolean;
      tasks: Array<{ wbsCode: string }>;
    };
    expect(first.total).toBe(11);
    expect(first.returned).toBe(4);
    // Cờ này là cả điểm của bài test: thiếu nó thì 4 dòng đầu của cây 11 dòng trông y
    // hệt một cây 4 dòng đầy đủ.
    expect(first.truncated).toBe(true);

    const last = (await callTool('wbs_get_tree', { project: 'UTG', limit: 4, offset: 8 }))
      .result as { returned: number; truncated: boolean; tasks: Array<{ wbsCode: string }> };
    expect(last.returned).toBe(3);
    expect(last.truncated).toBe(false);

    // Ghép các trang lại phải ra đúng cây ban đầu, không trùng không sót.
    const paged: string[] = [];
    for (let offset = 0; offset < 11; offset += 4) {
      const p = (await callTool('wbs_get_tree', { project: 'UTG', limit: 4, offset })).result as {
        tasks: Array<{ wbsCode: string }>;
      };
      paged.push(...p.tasks.map((t) => t.wbsCode));
    }
    expect(paged).toEqual(
      (await tasksOf('wbs_get_tree', { project: 'UTG' })).map((t) => t['wbsCode']),
    );
  });

  /**
   * §12.1 phân ba mức: `wbs_get_tree` "cây rút gọn", `wbs_list_tasks` "task + schedule",
   * `wbs_get_task` "task đầy đủ". Test khoá sự phân biệt đó lại — nó là lý do một câu
   * hỏi về hình dạng cây trên 6.000 task tốn 96 KB thay vì 361 KB.
   */
  it('cây rút gọn hẹp hơn danh sách task', async () => {
    const treeRow = (await tasksOf('wbs_get_tree', { project: 'UTG' }))[0];
    const listRow = (await tasksOf('wbs_list_tasks', { project: 'UTG' }))[0];
    expect(treeRow).toBeDefined();

    // Cây có đủ thứ để vẽ ra hình dạng…
    expect(Object.keys(treeRow ?? {}).sort()).toEqual([
      'depth',
      'effortMd',
      'endDate',
      'kind',
      'name',
      'parentUid',
      'percent',
      'startDate',
      'status',
      'uid',
      'wbsCode',
    ]);
    // …nhưng KHÔNG có nhãn phân loại; đó là việc của `wbs_list_tasks`.
    expect(treeRow).not.toHaveProperty('phase');
    expect(listRow).toHaveProperty('phase');
    expect(listRow).toHaveProperty('assigneeName');
  });

  it('total đếm sau khi lọc, không phải cả dự án', async () => {
    const r = (await callTool('wbs_list_tasks', { project: 'UTG', phase: 'design' })).result as {
      total: number;
      truncated: boolean;
    };
    expect(r.total).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('wbs_get_task trả cả dependency hai chiều', async () => {
    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG', phase: 'build' });
    const uid = rows[0]?.['uid'];
    expect(uid).toBeDefined();

    const res = (await callTool('wbs_get_task', { uid })).result as {
      task: { name: string };
      dependencies: { predecessors: unknown[]; successors: unknown[] };
    };
    expect(res.task.name).toBe('Build');
    expect(res.dependencies.predecessors).toHaveLength(1);
    expect(res.dependencies.successors).toHaveLength(0);
  });

  it('wbs_get_task kiểm quyền qua dự án của task, không qua tham số', async () => {
    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG' });
    const res = await callTool('wbs_get_task', { uid: rows[0]?.['uid'] }, outsiderToken);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Not allowed');
  });

  it('wbs_get_schedule cộng MD của lá, không cộng summary', async () => {
    const res = (await callTool('wbs_get_schedule', { project: 'UTG' })).result as {
      totalMd: number;
      taskCount: number;
      byStatus: Record<string, number>;
    };
    // 2 + 3 + tám cái 1 MD. KHÔNG cộng summary — nó là rollup của chính các lá đó.
    expect(res.totalMd).toBe(13);
    expect(res.taskCount).toBe(10);
    expect(res.byStatus['not_started']).toBe(10);
  });

  it('wbs_validate trả ValidationReport đầy đủ', async () => {
    const report = (await callTool('wbs_validate', { project: 'UTG' })).result as {
      projectId: string;
      passed: boolean;
      counts: { critical: number };
      issues: unknown[];
    };
    expect(report.projectId).toBe('P');
    expect(report.counts.critical).toBe(0);
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it('chưa xếp lịch thì đường găng rỗng và explain không ném', async () => {
    const path = (await callTool('wbs_get_critical_path', { project: 'UTG' })).result;
    expect(path).toEqual([]);

    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG' });
    const explained = (await callTool('wbs_explain_task', { uid: rows[0]?.['uid'] })).result as {
      chain: Array<{ reason: string | null }>;
      truncated: boolean;
    };
    expect(explained.chain).toHaveLength(1);
    expect(explained.chain[0]?.reason).toBeNull();
    expect(explained.truncated).toBe(false);
  });

  it('explain lần theo chuỗi chặn dependency và dừng ở mắt không phải dependency', async () => {
    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG' });
    const design = rows.find((t) => t['name'] === 'Design');
    const build = rows.find((t) => t['name'] === 'Build');
    expect(design && build).toBeTruthy();

    // Lịch giả lập: Build bị Design chặn, Design bị thiếu người chặn. Chuỗi phải đi một
    // bước rồi DỪNG — `blocking_ref` của Design là một resource id, không phải task.
    const ins = db.prepare(
      `INSERT INTO schedule (task_uid,start_date,end_date,is_critical,delay_reason,blocking_ref,computed_at)
       VALUES (?,?,?,1,?,?,?)`,
    );
    ins.run(design?.['uid'], '2026-01-07', '2026-01-08', 'resource', 'R-1', AT);
    ins.run(build?.['uid'], '2026-01-09', '2026-01-13', 'dependency', design?.['uid'], AT);

    const res = (await callTool('wbs_explain_task', { uid: build?.['uid'] })).result as {
      chain: Array<{ taskUid: string; reason: string | null; ref: string | null }>;
      truncated: boolean;
    };
    expect(res.chain.map((l) => l.taskUid)).toEqual([build?.['uid'], design?.['uid']]);
    expect(res.chain[1]?.reason).toBe('resource');
    expect(res.chain[1]?.ref).toBe('R-1');
    expect(res.truncated).toBe(false);
  });

  it('mode cpm trả đúng task có float 0', async () => {
    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG' });
    const design = rows.find((t) => t['name'] === 'Design');
    const build = rows.find((t) => t['name'] === 'Build');

    const ins = db.prepare(
      `INSERT INTO schedule (task_uid,start_date,end_date,is_critical,computed_at)
       VALUES (?,?,?,?,?)`,
    );
    ins.run(design?.['uid'], '2026-01-07', '2026-01-08', 1, AT);
    ins.run(build?.['uid'], '2026-01-09', '2026-01-13', 0, AT);

    const cpm = (await callTool('wbs_get_critical_path', { project: 'UTG', mode: 'cpm' }))
      .result as Array<{ name: string }>;
    expect(cpm.map((t) => t.name)).toEqual(['Design']);
  });

  /**
   * §7 pha C bước C1, PM chốt phương án (b) ngày 2026-09-13. Hai chế độ đọc hai cột
   * khác nhau, và khác biệt giữa chúng là thứ §7.2 gọi là chi phí do thiếu người.
   */
  it('mode resource đọc cột khác mode cpm', async () => {
    const rows = await tasksOf('wbs_list_tasks', { project: 'UTG' });
    const design = rows.find((t) => t['name'] === 'Design');
    const build = rows.find((t) => t['name'] === 'Build');

    db.prepare(
      `INSERT INTO schedule (task_uid,start_date,end_date,is_critical,is_resource_critical,computed_at)
       VALUES (?,?,?,1,0,?)`,
    ).run(design?.['uid'], '2026-01-07', '2026-01-08', AT);
    db.prepare(
      `INSERT INTO schedule (task_uid,start_date,end_date,is_critical,is_resource_critical,computed_at)
       VALUES (?,?,?,0,1,?)`,
    ).run(build?.['uid'], '2026-01-09', '2026-01-13', AT);

    const cpm = (await callTool('wbs_get_critical_path', { project: 'UTG', mode: 'cpm' }))
      .result as Array<{ name: string }>;
    const resource = (await callTool('wbs_get_critical_path', { project: 'UTG', mode: 'resource' }))
      .result as Array<{ name: string }>;
    expect(cpm.map((t) => t.name)).toEqual(['Design']);
    expect(resource.map((t) => t.name)).toEqual(['Build']);
  });
});
