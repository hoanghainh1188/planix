/**
 * HTTP adapter — SPEC.md §3.1 (Hono + tRPC), §13.1, §13.3.
 *
 * Một tiến trình phục vụ cả API lẫn UI tĩnh, đúng như §13.1 mô tả. Caddy đứng trước lo
 * HTTPS; ở đây chỉ lo phần ứng dụng.
 */

import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Db } from '@planix/core/db/migrate.js';
import { appRouter, type Context } from '../router/index.js';
import {
  destroySession,
  getSession,
  login,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from '../auth/session.js';
import { securityHeaders } from './security.js';

export interface AppConfig {
  readonly db: Db;
  /** Đường dẫn file DB — worker lập lịch cần mở kết nối riêng (§7.14). */
  readonly dbPath: string;
  /** Bật HSTS. Chỉ true khi thật sự chạy sau HTTPS. */
  readonly enableHsts: boolean;
  /** Nguồn thời gian, truyền vào để test không phụ thuộc đồng hồ. */
  readonly now?: () => string;
}

interface Vars {
  nonce: string;
}

/**
 * `exactOptionalPropertyTypes` phân biệt "không có khoá" với "khoá mang undefined".
 * Helper này chỉ thêm khoá khi thật sự có giá trị, thay vì rải ba lần cùng một ternary.
 */
function userAgentField(value: string | undefined): { userAgent?: string } {
  return value === undefined ? {} : { userAgent: value };
}

export function createApp(config: AppConfig): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const now = config.now ?? ((): string => new Date().toISOString());

  app.use('*', async (c, next) => {
    // Nonce MỚI cho từng request. Dùng lại một nonce cố định thì nó không còn là nonce,
    // và CSP trở lại ngang mức `unsafe-inline`.
    const nonce = randomBytes(16).toString('base64');
    c.set('nonce', nonce);
    await next();
    for (const [key, value] of Object.entries(
      securityHeaders({ enableHsts: config.enableHsts, nonce }),
    )) {
      c.header(key, value);
    }
  });

  // ── Đăng nhập (§13.3) ─────────────────────────────────────────────────────
  app.post('/api/login', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const email =
      typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined;
    const password =
      typeof body === 'object' && body !== null
        ? (body as { password?: unknown }).password
        : undefined;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const result = await login(config.db, {
      email,
      password,
      // Caddy đứng trước nên IP thật nằm ở X-Forwarded-For; không có thì dùng 'unknown'
      // và mọi request không xác định được IP chia nhau một hạn mức.
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      now: now(),
      ...userAgentField(c.req.header('user-agent')),
    });

    if (!result.ok) {
      // 429 cho rate limit để client phân biệt được "thử lại sau" và "sai thông tin".
      return c.json({ error: result.reason }, result.reason === 'rate_limited' ? 429 : 401);
    }

    setCookie(c, SESSION_COOKIE, result.session.id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });
    return c.json({ ok: true, userId: result.user.userId, isAdmin: result.user.isAdmin });
  });

  app.post('/api/logout', (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId !== undefined) destroySession(config.db, sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const user = sessionId === undefined ? null : getSession(config.db, sessionId, now());
    if (user === null) return c.json({ user: null }, 401);
    return c.json({ user });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ── tRPC ──────────────────────────────────────────────────────────────────
  app.all('/trpc/*', (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const user = sessionId === undefined ? null : getSession(config.db, sessionId, now());

    return fetchRequestHandler({
      endpoint: '/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: (): Context => ({
        db: config.db,
        user,
        now: now(),
        dbPath: config.dbPath,
      }),
    });
  });

  return app;
}
