/**
 * Phiên đăng nhập và giới hạn thử mật khẩu — SPEC.md §13.3.
 *
 * §13.3 chốt: session cookie `HttpOnly`, `Secure`, `SameSite=Lax`, hết hạn 7 ngày; giới
 * hạn 5 lần đăng nhập sai / 15 phút / IP; không đăng ký công khai, admin tạo tài khoản.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '@planix/core/db/migrate.js';
import * as repo from '@planix/core/db/repo/auth-repo.js';
import { hashPassword, verifyPassword, type PasswordOptions } from './password.js';

export type { Db };

export const SESSION_TTL_DAYS = 7;
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MINUTES = 15;

/** Tên cookie. Tiền tố `__Host-` buộc trình duyệt chỉ gửi qua HTTPS, đúng origin, path `/`. */
export const SESSION_COOKIE = '__Host-planix_session';

export interface SessionUser {
  readonly userId: string;
  readonly isAdmin: boolean;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function addDays(iso: string, days: number): string {
  return addMinutes(iso, days * 24 * 60);
}

/**
 * Thuộc tính cookie theo §13.3.
 *
 * `Secure` luôn bật kể cả khi dev chạy HTTP: §13.3 nói HTTPS bắt buộc và HSTS bật, nên
 * một cookie thiếu `Secure` lọt lên production là lỗ hổng thật. Dev muốn chạy HTTP thì
 * dùng `localhost`, nơi trình duyệt vẫn chấp nhận cookie `Secure`.
 */
export function sessionCookieAttributes(expiresAt: string): string {
  return [
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Expires=${new Date(Date.parse(expiresAt)).toUTCString()}`,
  ].join('; ');
}

/** Sinh id phiên. 32 byte ngẫu nhiên — đoán được thì coi như chiếm được tài khoản. */
function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function createSession(
  db: Db,
  params: { userId: string; now: string; userAgent?: string; ip?: string },
): { id: string; expiresAt: string } {
  const id = newSessionId();
  const expiresAt = addDays(params.now, SESSION_TTL_DAYS);
  repo.insertSession(db, {
    id,
    userId: params.userId,
    createdAt: params.now,
    expiresAt,
    userAgent: params.userAgent ?? null,
    ip: params.ip ?? null,
  });
  return { id, expiresAt };
}

/** Phiên còn hiệu lực, hoặc `null`. Phiên hết hạn bị coi như không tồn tại. */
export function getSession(db: Db, sessionId: string, now: string): SessionUser | null {
  const row = repo.findSession(db, sessionId);

  if (row === undefined) return null;
  if (row.expiresAt <= now) return null;
  // Admin vô hiệu hoá tài khoản thì phiên đang mở phải chết theo, không đợi hết hạn.
  if (!row.isActive) return null;

  return { userId: row.userId, isAdmin: row.isAdmin };
}

export function destroySession(db: Db, sessionId: string): void {
  repo.deleteSession(db, sessionId);
}

/** Dọn phiên hết hạn. Gọi định kỳ; không phải đường nóng. */
export function purgeExpiredSessions(db: Db, now: string): number {
  return repo.deleteExpiredSessions(db, now);
}

// ── Giới hạn thử mật khẩu (§13.3) ───────────────────────────────────────────

export function recordLoginAttempt(
  db: Db,
  params: { ip: string; email: string | null; at: string; successful: boolean },
): void {
  repo.insertLoginAttempt(db, params);
}

export function failedAttemptsSince(db: Db, ip: string, since: string): number {
  return repo.countFailedAttempts(db, ip, since);
}

export function isRateLimited(db: Db, ip: string, now: string): boolean {
  const since = addMinutes(now, -ATTEMPT_WINDOW_MINUTES);
  return failedAttemptsSince(db, ip, since) >= MAX_FAILED_ATTEMPTS;
}

// ── Đăng nhập ───────────────────────────────────────────────────────────────

export type LoginFailure = 'rate_limited' | 'invalid_credentials';

export type LoginResult =
  | {
      readonly ok: true;
      readonly session: { id: string; expiresAt: string };
      readonly user: SessionUser;
    }
  | { readonly ok: false; readonly reason: LoginFailure };

/**
 * Đăng nhập.
 *
 * Email sai và mật khẩu sai trả CÙNG một lý do `invalid_credentials`. Phân biệt hai
 * trường hợp là cho người ngoài biết email nào có trong hệ thống.
 */
export async function login(
  db: Db,
  params: { email: string; password: string; ip: string; now: string; userAgent?: string },
): Promise<LoginResult> {
  if (isRateLimited(db, params.ip, params.now)) {
    return { ok: false, reason: 'rate_limited' };
  }

  const row = repo.findUserByEmail(db, params.email);

  const ok =
    row !== undefined && row.isActive && (await verifyPassword(params.password, row.passwordHash));

  recordLoginAttempt(db, {
    ip: params.ip,
    email: params.email,
    at: params.now,
    successful: ok,
  });

  if (!ok || row === undefined) return { ok: false, reason: 'invalid_credentials' };

  const session = createSession(db, {
    userId: row.id,
    now: params.now,
    ...(params.userAgent === undefined ? {} : { userAgent: params.userAgent }),
    ip: params.ip,
  });
  return { ok: true, session, user: { userId: row.id, isAdmin: row.isAdmin } };
}

/**
 * Tạo tài khoản. §13.3: **không đăng ký công khai** — chỉ admin gọi được đường này.
 * Việc kiểm người gọi có phải admin không thuộc về router, không thuộc về hàm này.
 */
export async function createUser(
  db: Db,
  params: {
    id: string;
    email: string;
    name: string;
    password: string;
    isAdmin: boolean;
    now: string;
  },
  passwordOptions: PasswordOptions = {},
): Promise<void> {
  const passwordHash = await hashPassword(params.password, passwordOptions);
  repo.insertUser(db, { ...params, passwordHash });
}

/** So chuỗi theo thời gian hằng định — dùng cho bearer token của MCP (§12.4). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
