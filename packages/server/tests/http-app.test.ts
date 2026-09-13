import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { createApp } from '../src/http/app.js';
import { createUser } from '../src/auth/session.js';

const AT = '2026-09-13T09:00:00.000Z';
const FAST = { memoryCost: 8, timeCost: 1 };
const PASSWORD = 'mat-khau-dung-rat-dai';

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof createApp>;

function makeApp(over = {}) {
  return createApp({ db, dbPath: ':memory:', enableHsts: true, now: () => AT, ...over });
}

/** Lấy cookie phiên từ phản hồi đăng nhập. */
function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

beforeEach(async () => {
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
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();

  await createUser(
    db,
    { id: 'U-PM', email: 'pm@x.com', name: 'PM', password: PASSWORD, isAdmin: false, now: AT },
    FAST,
  );
  db.prepare(`INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P','pm')`).run();

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

  app = makeApp();
});
afterEach(() => db.close());

async function loginOk(): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pm@x.com', password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe('header bảo mật (§13.3)', () => {
  it('gửi đủ bộ header phòng thủ', async () => {
    const res = await app.request('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toMatch(/camera=\(\)/);
  });

  it('CSP dùng nonce, KHÔNG dùng unsafe-inline cho script', async () => {
    const csp = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });

  it('nonce KHÁC nhau giữa hai request — dùng lại thì nó hết là nonce', async () => {
    const a = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    const b = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    expect(a).not.toBe(b);
  });

  it('HSTS chỉ gửi khi thật sự chạy sau HTTPS', async () => {
    const withHsts = await app.request('/api/health');
    expect(withHsts.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);

    // Bat HSTS tren HTTP o may dev se ghim localhost vao https trong mot nam.
    const dev = makeApp({ enableHsts: false });
    expect((await dev.request('/api/health')).headers.get('strict-transport-security')).toBeNull();
  });
});

describe('đăng nhập qua HTTP (§13.3)', () => {
  it('đúng mật khẩu thì đặt cookie phiên với đủ thuộc tính', async () => {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pm@x.com', password: PASSWORD }),
    });
    expect(res.status).toBe(200);

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/__Host-/);
  });

  it('sai mật khẩu trả 401', async () => {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pm@x.com', password: 'sai' }),
    });
    expect(res.status).toBe(401);
  });

  it('body hỏng trả 400 chứ không nổ', async () => {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'khong-phai-json',
    });
    expect(res.status).toBe(400);
  });

  it('vượt hạn mức trả 429 để client phân biệt được với sai mật khẩu', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ email: 'pm@x.com', password: 'sai' }),
      });
    }
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
      body: JSON.stringify({ email: 'pm@x.com', password: PASSWORD }),
    });
    expect(res.status).toBe(429);
  });

  it('hạn mức tính theo IP trong X-Forwarded-For, không lây sang IP khác', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
        body: JSON.stringify({ email: 'pm@x.com', password: 'sai' }),
      });
    }
    const other = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify({ email: 'pm@x.com', password: PASSWORD }),
    });
    expect(other.status).toBe(200);
  });
});

describe('/api/me và đăng xuất', () => {
  it('chưa đăng nhập trả 401', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
  });

  it('có cookie thì trả về người dùng', async () => {
    const cookie = await loginOk();
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { userId: 'U-PM', isAdmin: false } });
  });

  it('đăng xuất làm phiên chết ngay', async () => {
    const cookie = await loginOk();
    await app.request('/api/logout', { method: 'POST', headers: { cookie } });
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  });
});

describe('tRPC qua HTTP', () => {
  async function query(path: string, input: unknown, cookie?: string): Promise<Response> {
    const url = `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
    return app.request(url, cookie === undefined ? {} : { headers: { cookie } });
  }

  it('chưa đăng nhập thì procedure trả lỗi UNAUTHORIZED', async () => {
    const res = await query('projects.list', undefined);
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe('UNAUTHORIZED');
  });

  it('đăng nhập rồi thì đọc được danh sách dự án', async () => {
    const cookie = await loginOk();
    const res = await query('projects.list', undefined, cookie);
    const body = (await res.json()) as { result?: { data?: Array<{ code: string }> } };
    expect(body.result?.data?.map((p) => p.code)).toEqual(['UTG']);
  });

  it('đọc được cây WBS của dự án được gán', async () => {
    const cookie = await loginOk();
    const res = await query('wbs.tree', { projectId: 'P' }, cookie);
    const body = (await res.json()) as { result?: { data?: Array<{ wbsCode: string }> } };
    expect(body.result?.data?.map((r) => r.wbsCode)).toEqual(['1', '1.1']);
  });

  it('quyền vẫn kiểm ở SERVER qua đường HTTP — PM không chạy được Recalculate all', async () => {
    const cookie = await loginOk();
    const res = await app.request('/trpc/wbs.recalculate', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'P', scope: 'all' }),
    });
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe('FORBIDDEN');
  });

  it('cookie giả mạo không mở được gì', async () => {
    const res = await query('projects.list', undefined, '__Host-planix_session=gia-mao');
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe('UNAUTHORIZED');
  });

  it('lỗi KHÔNG kèm stack trace — kẻ chưa đăng nhập không được thấy đường dẫn máy chủ', async () => {
    const res = await query('projects.list', undefined);
    const raw = await res.text();

    expect(raw).not.toContain('stack');
    // Kiểm cả nội dung, không chỉ tên trường: stack là thứ để lộ cây thư mục thật.
    expect(raw).not.toContain('/packages/server/');

    const body = JSON.parse(raw) as { error?: { data?: Record<string, unknown> } };
    expect(body.error?.data?.['code']).toBe('UNAUTHORIZED');
    expect(body.error?.data).not.toHaveProperty('stack');
  });
});
