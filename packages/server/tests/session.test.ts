import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import {
  ATTEMPT_WINDOW_MINUTES,
  createSession,
  createUser,
  destroySession,
  failedAttemptsSince,
  getSession,
  isRateLimited,
  login,
  MAX_FAILED_ATTEMPTS,
  purgeExpiredSessions,
  recordLoginAttempt,
  safeEqual,
  SESSION_COOKIE,
  sessionCookieAttributes,
} from '../src/auth/session.js';

const FAST = { memoryCost: 8, timeCost: 1 };
const T0 = '2026-09-13T09:00:00.000Z';
const later = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

let db: ReturnType<typeof openDatabase>;

beforeEach(async () => {
  db = openDatabase(':memory:');
  migrate(db, T0);
  await createUser(
    db,
    {
      id: 'U-1',
      email: 'pm@x.com',
      name: 'PM',
      password: 'dung-mat-khau',
      isAdmin: false,
      now: T0,
    },
    FAST,
  );
});
afterEach(() => db.close());

describe('cookie phiên (§13.3)', () => {
  it('có HttpOnly, Secure, SameSite=Lax', () => {
    const attrs = sessionCookieAttributes(later(60));
    expect(attrs).toMatch(/HttpOnly/);
    expect(attrs).toMatch(/Secure/);
    expect(attrs).toMatch(/SameSite=Lax/);
  });

  it('tên cookie có tiền tố __Host- để buộc HTTPS và đúng origin', () => {
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
  });
});

describe('vòng đời phiên', () => {
  it('tạo rồi đọc lại được', () => {
    const s = createSession(db, { userId: 'U-1', now: T0 });
    expect(getSession(db, s.id, T0)).toEqual({ userId: 'U-1', isAdmin: false });
  });

  it('hết hạn sau 7 ngày (§13.3)', () => {
    const s = createSession(db, { userId: 'U-1', now: T0 });
    const justBefore = later(7 * 24 * 60 - 1);
    const justAfter = later(7 * 24 * 60 + 1);
    expect(getSession(db, s.id, justBefore)).not.toBeNull();
    expect(getSession(db, s.id, justAfter)).toBeNull();
  });

  it('id phiên không đoán được: hai phiên khác nhau, đủ dài', () => {
    const a = createSession(db, { userId: 'U-1', now: T0 });
    const b = createSession(db, { userId: 'U-1', now: T0 });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(40);
  });

  it('đăng xuất thì phiên chết ngay', () => {
    const s = createSession(db, { userId: 'U-1', now: T0 });
    destroySession(db, s.id);
    expect(getSession(db, s.id, T0)).toBeNull();
  });

  it('vô hiệu hoá tài khoản thì phiên đang mở chết theo, không đợi hết hạn', () => {
    const s = createSession(db, { userId: 'U-1', now: T0 });
    db.prepare('UPDATE app_user SET is_active = 0 WHERE id = ?').run('U-1');
    expect(getSession(db, s.id, T0)).toBeNull();
  });

  it('id không tồn tại thì null, không ném', () => {
    expect(getSession(db, 'khong-co', T0)).toBeNull();
  });

  it('purge xoá phiên hết hạn', () => {
    createSession(db, { userId: 'U-1', now: T0 });
    expect(purgeExpiredSessions(db, later(8 * 24 * 60))).toBe(1);
  });
});

describe('giới hạn thử mật khẩu (§13.3: 5 lần / 15 phút / IP)', () => {
  const fail = (at: string, ip = '1.2.3.4') =>
    recordLoginAttempt(db, { ip, email: 'pm@x.com', at, successful: false });

  it('chưa tới 5 lần thì chưa chặn', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) fail(later(i));
    expect(isRateLimited(db, '1.2.3.4', later(1))).toBe(false);
  });

  it('đủ 5 lần thì chặn', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) fail(later(i));
    expect(isRateLimited(db, '1.2.3.4', later(1))).toBe(true);
  });

  it('lần sai cũ hơn 15 phút không còn tính', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) fail(later(i));
    expect(isRateLimited(db, '1.2.3.4', later(ATTEMPT_WINDOW_MINUTES + 10))).toBe(false);
  });

  it('chặn theo IP, không lây sang IP khác', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) fail(later(i), '1.2.3.4');
    expect(isRateLimited(db, '9.9.9.9', later(1))).toBe(false);
  });

  it('lần đăng nhập THÀNH CÔNG không tính vào hạn mức', () => {
    for (let i = 0; i < 10; i++) {
      recordLoginAttempt(db, { ip: '1.2.3.4', email: 'pm@x.com', at: later(i), successful: true });
    }
    expect(failedAttemptsSince(db, '1.2.3.4', T0)).toBe(0);
  });
});

describe('đăng nhập', () => {
  const params = (over = {}) => ({
    email: 'pm@x.com',
    password: 'dung-mat-khau',
    ip: '1.2.3.4',
    now: T0,
    ...over,
  });

  it('đúng mật khẩu thì cấp phiên', async () => {
    const r = await login(db, params());
    expect(r.ok).toBe(true);
    if (r.ok) expect(getSession(db, r.session.id, T0)).toEqual({ userId: 'U-1', isAdmin: false });
  });

  it('sai mật khẩu thì từ chối', async () => {
    const r = await login(db, params({ password: 'sai' }));
    expect(r).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('email KHÔNG tồn tại trả CÙNG lý do với mật khẩu sai', async () => {
    const a = await login(db, params({ email: 'khong-co@x.com' }));
    const b = await login(db, params({ password: 'sai' }));
    // Phan biet hai truong hop la cho nguoi ngoai biet email nao co trong he thong.
    expect(a).toEqual(b);
  });

  it('tài khoản bị vô hiệu hoá không đăng nhập được dù đúng mật khẩu', async () => {
    db.prepare('UPDATE app_user SET is_active = 0 WHERE id = ?').run('U-1');
    const r = await login(db, params());
    expect(r).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('mỗi lần sai đều được ghi lại, và tới ngưỡng thì bị chặn', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await login(db, params({ password: 'sai', now: later(i) }));
    }
    const r = await login(db, params({ now: later(1) }));
    expect(r).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('bị chặn thì KHÔNG kiểm mật khẩu nữa, kể cả mật khẩu đúng', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await login(db, params({ password: 'sai', now: later(i) }));
    }
    const r = await login(db, params({ password: 'dung-mat-khau', now: later(2) }));
    expect(r).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

describe('safeEqual — cho bearer token MCP (§12.4)', () => {
  it('đúng thì true, sai thì false', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'abc124')).toBe(false);
  });

  it('độ dài khác nhau không làm nổ', () => {
    expect(safeEqual('ngan', 'dai-hon-nhieu')).toBe(false);
  });
});
