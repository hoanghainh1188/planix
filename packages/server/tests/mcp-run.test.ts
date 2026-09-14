/**
 * Tool chạy của lớp MCP — SPEC.md §12.3.
 *
 * Chỗ rủi ro nhất ở đây là `wbs_export_excel`: nó là tool DUY NHẤT không mượn được
 * procedure tRPC (web xuất file qua một route HTTP đọc session cookie), nên lớp kiểm
 * quyền phải dựng lại bằng tay — và §10.6 phân quyền xuất theo LOẠI báo cáo, không chỉ
 * theo vai. Quên `reportKind` là mở cửa cho lead tải ma trận năng lực toàn đội.
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
let leadToken: string;
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

  for (const [id, email, role] of [
    ['U-PM', 'pm@x.com', 'pm'],
    ['U-LEAD', 'lead@x.com', 'lead'],
    ['U-VIEW', 'view@x.com', 'viewer'],
  ]) {
    db.prepare(
      `INSERT INTO app_user (id,email,name,password_hash,is_admin,created_at)
       VALUES (?,?,?,'x',0,?)`,
    ).run(id, email, id, AT);
    db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES (?,?,?)`).run(
      id,
      'P',
      role,
    );
  }

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
          module: 'core',
        },
        {
          tmp_id: 'b',
          parent_tmp_id: 'r',
          name: 'Build',
          kind: 'work',
          effort_md: 3,
          role: 'Dev',
          phase: 'build',
          module: 'core',
        },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );

  pmToken = createMcpToken(db, { userId: 'U-PM', label: 'pm', now: AT }).token;
  leadToken = createMcpToken(db, { userId: 'U-LEAD', label: 'lead', now: AT }).token;
  viewerToken = createMcpToken(db, { userId: 'U-VIEW', label: 'viewer', now: AT }).token;
  app = createApp({ db, dbPath: ':memory:', enableHsts: true, now: () => AT, log: silentSink });
});
afterEach(() => db.close());

let rpcId = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
  token: string = pmToken,
): Promise<{
  isError: boolean;
  result: Record<string, unknown>;
  text: string;
  content: Array<Record<string, unknown>>;
}> {
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
      content: Array<Record<string, unknown>>;
    };
    error?: { message: string };
  };
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  const r = body.result;
  if (r === undefined) throw new Error('no result');
  return {
    isError: r.isError === true,
    result: r.structuredContent?.result ?? {},
    text: (r.content[0]?.['text'] as string | undefined) ?? '',
    content: r.content,
  };
}

describe('wbs_export_excel — §10.6 phân quyền theo LOẠI báo cáo', () => {
  /**
   * Đây là ca quan trọng nhất của file.
   *
   * Lead được tải bản `full` nhưng KHÔNG được tải bản `resource` — ma trận năng lực toàn
   * đội là thứ của quản lý. Một lớp kiểm quyền chỉ nhìn vai sẽ cho qua cả hai, và không
   * test nào khác bắt được.
   */
  it('lead tải được bản full nhưng KHÔNG tải được bản resource', async () => {
    const full = await callTool('wbs_export_excel', { project: 'UTG', report: 'full' }, leadToken);
    expect(full.isError, full.text).toBe(false);

    const resource = await callTool(
      'wbs_export_excel',
      { project: 'UTG', report: 'resource' },
      leadToken,
    );
    expect(resource.isError).toBe(true);
    expect(resource.text).toContain('FORBIDDEN');
  });

  it('pm tải được cả ba bản', async () => {
    for (const report of ['full', 'summary', 'resource']) {
      const res = await callTool('wbs_export_excel', { project: 'UTG', report });
      expect(res.isError, `${report}: ${res.text}`).toBe(false);
    }
  });

  it('viewer không tải được gì', async () => {
    const res = await callTool('wbs_export_excel', { project: 'UTG', report: 'full' }, viewerToken);
    expect(res.isError).toBe(true);
  });
});

describe('wbs_export_excel — nội dung trả về', () => {
  it('kèm file base64 đúng định dạng xlsx', async () => {
    const res = await callTool('wbs_export_excel', { project: 'UTG', report: 'full' });
    expect(res.isError, res.text).toBe(false);

    const meta = res.result as { filename: string; bytes: number; fileIncluded: boolean };
    expect(meta.filename).toMatch(/\.xlsx$/);
    expect(meta.bytes).toBeGreaterThan(0);
    expect(meta.fileIncluded).toBe(true);

    const blobPart = res.content.find((c) => c['type'] === 'resource');
    expect(blobPart).toBeDefined();
    const resource = blobPart?.['resource'] as { blob: string; mimeType: string };
    expect(resource.mimeType).toContain('spreadsheetml');

    // xlsx là file zip — bốn byte đầu phải là chữ ký PK. Không kiểm chỗ này thì một chuỗi
    // base64 rỗng hay hỏng vẫn "qua".
    const bytes = Buffer.from(resource.blob, 'base64');
    expect(bytes.length).toBe(meta.bytes);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('include_file false thì chỉ trả mô tả, không trả bytes', async () => {
    const res = await callTool('wbs_export_excel', {
      project: 'UTG',
      report: 'full',
      include_file: false,
    });
    expect(res.isError).toBe(false);
    expect((res.result as { fileIncluded: boolean }).fileIncluded).toBe(false);
    expect(res.content.find((c) => c['type'] === 'resource')).toBeUndefined();
  });

  /**
   * §11.4 chặn hẳn khi có Critical — và phải trả DỮ LIỆU có cấu trúc, không phải một câu
   * lỗi: AI cần đọc danh sách để đi sửa.
   */
  it('có Critical thì chặn và liệt kê issue', async () => {
    // Gỡ role khỏi một task ⇒ không ai đảm nhiệm được ⇒ Critical.
    db.prepare(`UPDATE task SET role = 'KhongAiLamDuoc' WHERE name = 'Design'`).run();

    const res = await callTool('wbs_export_excel', { project: 'UTG', report: 'full' });
    expect(res.isError).toBe(false);
    const out = res.result as {
      ok: boolean;
      blocked: boolean;
      issues: Array<{ severity: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.blocked).toBe(true);
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.issues.every((i) => i.severity === 'Critical')).toBe(true);
  });
});

describe('wbs_close_period', () => {
  it('viewer không chốt được kỳ', async () => {
    const res = await callTool(
      'wbs_close_period',
      { project: 'UTG', status_date: '2026-01-09', label: 'Plan v1.0' },
      viewerToken,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain('FORBIDDEN');
  });

  /**
   * §7.13 DỪNG HẲN khi có Critical — khác mọi đường ghi khác (§12.4 cho ghi rồi báo).
   *
   * Baseline là mốc cam kết; dựng nó trên dữ liệu hỏng là làm hỏng chính thước đo. Và
   * việc từ chối phải về dưới dạng `ok: false` kèm danh sách, không phải `isError`.
   */
  it('có Critical thì từ chối, kèm danh sách để đi sửa', async () => {
    db.prepare(`UPDATE task SET role = 'KhongAiLamDuoc' WHERE name = 'Design'`).run();

    const res = await callTool('wbs_close_period', {
      project: 'UTG',
      status_date: '2026-01-09',
      label: 'Plan v1.0',
    });
    expect(res.isError).toBe(false);
    const out = res.result as { ok: boolean; issues: Array<unknown> };
    expect(out.ok).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);

    const n = db.prepare('SELECT COUNT(*) n FROM baseline').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('dữ liệu sạch thì chốt được và tạo baseline', async () => {
    const res = await callTool('wbs_close_period', {
      project: 'UTG',
      status_date: '2026-01-09',
      label: 'Plan v1.0',
    });
    expect(res.isError, res.text).toBe(false);
    const out = res.result as { ok: boolean; taskCount: number };
    expect(out.ok).toBe(true);
    expect(out.taskCount).toBeGreaterThan(0);

    const n = db.prepare('SELECT COUNT(*) n FROM baseline').get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('wbs_schedule', () => {
  it('viewer không chạy được engine', async () => {
    const res = await callTool('wbs_schedule', { project: 'UTG' }, viewerToken);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('FORBIDDEN');
  });

  /**
   * §10.6: `recalculate_project` là `{pm: true, lead: false}`, còn `recalculate_all` là
   * `{pm: false, lead: false}` — tức CHỈ admin.
   *
   * Bậc thang đó đáng kiểm vì nó trái trực giác: PM là người cao nhất trong một dự án,
   * nhưng `scope: 'all'` đụng vào lịch của MỌI dự án dùng chung pool nhân sự (§7.12), nên
   * nó không còn là quyết định của riêng dự án nào.
   *
   * Bản đầu tôi viết test này với lead và kỳ vọng lead xếp được dự án mình — sai; lead
   * không xếp lịch được. Bảng §10.6 mới là nguồn, không phải trực giác của tôi.
   */
  it("PM xếp được dự án mình nhưng KHÔNG xếp được scope 'all'", async () => {
    const all = await callTool('wbs_schedule', { project: 'UTG', scope: 'all' });
    expect(all.isError).toBe(true);
    expect(all.text).toContain('FORBIDDEN');

    const one = await callTool('wbs_schedule', { project: 'UTG', scope: 'project' });
    expect(one.text).not.toContain('FORBIDDEN');
  });

  it('lead KHÔNG xếp lịch được, kể cả dự án mình', async () => {
    const res = await callTool('wbs_schedule', { project: 'UTG', scope: 'project' }, leadToken);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('FORBIDDEN');
  });

  it('dự án không tồn tại thì báo NOT_FOUND', async () => {
    const res = await callTool('wbs_schedule', { project: 'KHONG-CO' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('NOT_FOUND');
  });
});

describe('danh sách tool', () => {
  it('đủ bộ chạy §12.3, và KHÔNG có wbs_what_if (thuộc P14)', async () => {
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
    for (const required of ['wbs_schedule', 'wbs_close_period', 'wbs_export_excel']) {
      expect(names, `thiếu ${required}`).toContain(required);
    }
    expect(names).not.toContain('wbs_what_if');
  });
});
