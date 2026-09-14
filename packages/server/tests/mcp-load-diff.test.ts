/**
 * Hai tool đọc còn lại của §12.1 — `wbs_get_resource_load` và `wbs_diff_baseline`.
 *
 * Phần thuật toán đã có test riêng ở `domain/resource-load.test.ts` và
 * `domain/baseline.test.ts`. Chỗ này kiểm phần GHÉP, vì đó là nơi lỗi thật hay nằm:
 * lấy đúng lịch của đúng người, chặn được baseline của dự án khác, và không trả về một
 * danh sách uid trần mà AI không tra lại được.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { createMcpToken } from '@planix/core/db/repo/mcp-token-repo.js';
import { closePeriod } from '@planix/core/db/repo/baseline-repo.js';
import { createApp } from '../src/http/app.js';
import { silentSink } from '../src/http/request-log.js';

const AT = '2026-09-14T09:00:00.000Z';

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof createApp>;
let token: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','JP','Asia/Tokyo','CAL-JP')`,
  ).run();
  // Lễ CHỈ ở lịch Nhật — đây là điều kiện để kiểm mẫu số dùng đúng lịch của từng người.
  db.prepare(
    `INSERT INTO calendar_exception (calendar_id,date_from,date_to,capacity,kind,note)
     VALUES ('CAL-JP','2026-01-07','2026-01-07',0,'holiday','lễ Nhật')`,
  ).run();

  for (const [id, code] of [
    ['P', 'UTG'],
    ['P2', 'GEO'],
  ]) {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES (?,?,?,1,'2026-01-05','2026-01-05','CAL-VN','VN',?)`,
    ).run(id, code, code, AT);
  }

  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-VN','An VN','VN')`).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-JP','Binh JP','JP')`).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-IDLE','Chưa xếp','VN')`).run();
  for (const id of ['R-VN', 'R-JP', 'R-IDLE']) {
    db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES (?, 'Dev')`).run(id);
  }

  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,is_admin,created_at)
     VALUES ('U-PM','pm@x.com','PM','x',0,?)`,
  ).run(AT);
  for (const p of ['P', 'P2']) {
    db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM',?,'pm')`).run(p);
  }

  for (const [code, prefix] of [
    ['UTG', 'a'],
    ['GEO', 'g'],
  ]) {
    importTasks(
      db,
      {
        version: '1.0',
        project_code: code,
        mode: 'merge',
        tasks: [
          { tmp_id: `${prefix}r`, parent_tmp_id: null, name: `Root ${code}`, kind: 'summary' },
          {
            tmp_id: `${prefix}1`,
            parent_tmp_id: `${prefix}r`,
            name: `Design ${code}`,
            kind: 'work',
            effort_md: 2,
            role: 'Dev',
            phase: 'design',
            module: 'core',
          },
        ],
        dependencies: [],
      },
      { runId: `I-${code}`, now: AT },
    );
  }

  token = createMcpToken(db, { userId: 'U-PM', label: 'pm', now: AT }).token;
  app = createApp({ db, dbPath: ':memory:', enableHsts: true, now: () => AT, log: silentSink });
});
afterEach(() => db.close());

let rpcId = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
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
  return (db.prepare('SELECT uid FROM task WHERE name = ?').get(name) as { uid: string }).uid;
}

/** Đặt chỗ tay: engine là đường duy nhất ghi `assignment`, mà test này không cần chạy engine. */
function assign(taskName: string, resourceId: string, from: string, to: string, alloc = 1): void {
  db.prepare(
    `INSERT INTO assignment (task_uid,resource_id,allocation,from_date,to_date,is_pinned)
     VALUES (?,?,?,?,?,0)`,
  ).run(uidOf(taskName), resourceId, alloc, from, to);
}

interface LoadOut {
  buckets: string[];
  rows: Array<{
    resourceId: string;
    resourceName: string;
    totalAllocatedMd: number;
    totalCapacityMd: number;
    cells: Array<{
      bucket: string;
      allocatedMd: number;
      capacityMd: number;
      otherProjectMd: number;
    }>;
  }>;
}

describe('wbs_get_resource_load', () => {
  it('người CHƯA được xếp việc vẫn hiện, với năng lực đầy đủ', async () => {
    const out = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'week',
        from: '2026-01-05',
        to: '2026-01-09',
      })
    ).result as unknown as LoadOut;

    const idle = out.rows.find((r) => r.resourceId === 'R-IDLE');
    expect(idle, 'người rảnh phải có mặt — đó là câu hỏi hay được hỏi nhất').toBeDefined();
    expect(idle?.totalAllocatedMd).toBe(0);
    expect(idle?.totalCapacityMd).toBe(5);
  });

  /**
   * Ca quan trọng nhất của tool này: mẫu số phải theo lịch của ĐÚNG người.
   *
   * R-VN và R-JP cùng khoảng, cùng allocation. Lễ Nhật 2026-01-07 chỉ nghỉ ở `CAL-JP`.
   * Nếu lấy nhầm lịch dự án (VN) cho cả hai thì hai dòng sẽ giống hệt nhau, và cả tool
   * mất đúng thứ khiến nó có ích với đội làm cho khách Nhật.
   */
  it('mẫu số dùng lịch của từng người, không phải lịch dự án', async () => {
    assign('Design UTG', 'R-VN', '2026-01-05', '2026-01-09');
    const out = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'week',
        from: '2026-01-05',
        to: '2026-01-09',
      })
    ).result as unknown as LoadOut;

    const vn = out.rows.find((r) => r.resourceId === 'R-VN');
    const jp = out.rows.find((r) => r.resourceId === 'R-JP');
    expect(vn?.totalCapacityMd).toBe(5);
    // Người Nhật mất một ngày vì lễ.
    expect(jp?.totalCapacityMd).toBe(4);
  });

  /**
   * §7.12 — pool dùng chung. Không có `cross_project` thì một người bận kín ở dự án khác
   * trông như đang rảnh, và đó là câu trả lời sai.
   */
  it('cross_project đổi kết quả một cách nhìn thấy được', async () => {
    assign('Design GEO', 'R-VN', '2026-01-05', '2026-01-09');

    const without = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'week',
        from: '2026-01-05',
        to: '2026-01-09',
      })
    ).result as unknown as LoadOut;
    const withCross = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'week',
        from: '2026-01-05',
        to: '2026-01-09',
        cross_project: true,
      })
    ).result as unknown as LoadOut;

    expect(without.rows.find((r) => r.resourceId === 'R-VN')?.totalAllocatedMd).toBe(0);
    const cross = withCross.rows.find((r) => r.resourceId === 'R-VN');
    expect(cross?.totalAllocatedMd).toBe(5);
    expect(cross?.cells[0]?.otherProjectMd).toBe(5);
    // Và của dự án đang xét vẫn là 0 — hai con số tách bạch, không trộn.
    expect(cross?.cells[0]?.allocatedMd).toBe(0);
  });

  it('chia kỳ theo ngày / tuần / tháng', async () => {
    const byDay = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'day',
        from: '2026-01-05',
        to: '2026-01-07',
      })
    ).result as unknown as LoadOut;
    expect(byDay.buckets).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);

    const byMonth = (
      await callTool('wbs_get_resource_load', {
        project: 'UTG',
        by: 'month',
        from: '2026-01-05',
        to: '2026-02-10',
      })
    ).result as unknown as LoadOut;
    expect(byMonth.buckets).toEqual(['2026-01', '2026-02']);
  });

  it('cửa sổ quá rộng thì báo lỗi rõ ràng, không treo', async () => {
    const res = await callTool('wbs_get_resource_load', {
      project: 'UTG',
      by: 'month',
      from: '2020-01-01',
      to: '2030-01-01',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('limit');
  });
});

describe('wbs_diff_baseline', () => {
  function takeBaseline(id: string, projectId = 'P'): void {
    closePeriod(db, {
      projectId,
      statusDate: '2026-01-09' as never,
      label: id,
      takenBy: 'U-PM',
      takenAt: AT,
      runId: `r-${id}`,
      baselineId: id,
    });
  }

  it('chưa có baseline thì nói rõ, không trả rỗng', async () => {
    const res = await callTool('wbs_diff_baseline', { project: 'UTG' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('no baseline');
  });

  it('thêm task thì hiện ở added kèm MD — con số scope creep', async () => {
    takeBaseline('B-1');
    importTasks(
      db,
      {
        version: '1.0',
        project_code: 'UTG',
        mode: 'merge',
        tasks: [
          {
            tmp_id: 'new',
            parent_uid: uidOf('Root UTG'),
            name: 'Việc phát sinh',
            kind: 'work',
            effort_md: 7,
            role: 'Dev',
            phase: 'build',
            module: 'core',
          },
        ],
        dependencies: [],
      },
      { runId: 'I2', now: AT },
    );

    const out = (await callTool('wbs_diff_baseline', { project: 'UTG' })).result as unknown as {
      added: Array<{ uid: string; wbsCode: string; name: string }>;
      addedEffortMd: number;
    };
    expect(out.added).toHaveLength(1);
    expect(out.added[0]?.name).toBe('Việc phát sinh');
    expect(out.addedEffortMd).toBe(7);
  });

  /**
   * Task đã bị XOÁ vẫn phải có tên và mã.
   *
   * Bản chụp là nơi DUY NHẤT còn hai thứ đó — task không còn trong DB nữa. Trả về uid
   * trần thì AI không có cách nào tra lại, và "T-0007 đã bị xoá" không nói được gì với ai.
   */
  it('task đã xoá vẫn kèm tên và mã lấy từ bản chụp', async () => {
    takeBaseline('B-1');
    const uid = uidOf('Design UTG');
    db.prepare('DELETE FROM task WHERE uid = ?').run(uid);

    const out = (await callTool('wbs_diff_baseline', { project: 'UTG' })).result as unknown as {
      removed: Array<{ uid: string; wbsCode: string; name: string }>;
    };
    expect(out.removed).toHaveLength(1);
    expect(out.removed[0]?.uid).toBe(uid);
    expect(out.removed[0]?.name).toBe('Design UTG');
    expect(out.removed[0]?.wbsCode).not.toBe('');
  });

  it('đổi effort thì hiện ở effortChanged kèm delta', async () => {
    takeBaseline('B-1');
    db.prepare(`UPDATE task SET effort_md = 9 WHERE name = 'Design UTG'`).run();

    const out = (await callTool('wbs_diff_baseline', { project: 'UTG' })).result as unknown as {
      effortChanged: Array<{ name: string; from: number; to: number; delta: number }>;
    };
    expect(out.effortChanged).toHaveLength(1);
    expect(out.effortChanged[0]).toMatchObject({ from: 2, to: 9, delta: 7 });
    expect(out.effortChanged[0]?.name).toBe('Design UTG');
  });

  /** Id baseline là chuỗi tự do từ client — không được so với dự án khác. */
  it('KHÔNG so được với baseline của dự án khác', async () => {
    takeBaseline('B-1');
    takeBaseline('B-GEO', 'P2');

    const res = await callTool('wbs_diff_baseline', { project: 'UTG', baseline_id: 'B-GEO' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('does not belong');
  });

  it('không truyền baseline_id thì lấy bản mới nhất', async () => {
    takeBaseline('B-1');
    const out = (await callTool('wbs_diff_baseline', { project: 'UTG' })).result as unknown as {
      baseline: { id: string; label: string };
    };
    expect(out.baseline.id).toBe('B-1');
    expect(out.baseline.label).toBe('B-1');
  });

  it('wbs_list_baselines liệt kê được', async () => {
    takeBaseline('B-1');
    const out = (await callTool('wbs_list_baselines', { project: 'UTG' }))
      .result as unknown as Array<{ id: string }>;
    expect(out.map((b) => b.id)).toContain('B-1');
  });
});
