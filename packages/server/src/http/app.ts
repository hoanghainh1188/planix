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
import { exportExcel, ExportBlockedError, type ReportKind } from '@planix/core/io/excel/index.js';
import { assertCan, ForbiddenError } from '../auth/permissions.js';
import { findProjectRole } from '@planix/core/db/repo/auth-repo.js';
import { redactPath, stdoutSink, type LogSink } from './request-log.js';

export interface AppConfig {
  readonly db: Db;
  /** Đường dẫn file DB — worker lập lịch cần mở kết nối riêng (§7.14). */
  readonly dbPath: string;
  /** Bật HSTS. Chỉ true khi thật sự chạy sau HTTPS. */
  readonly enableHsts: boolean;
  /** Nguồn thời gian, truyền vào để test không phụ thuộc đồng hồ. */
  readonly now?: () => string;
  /** Nơi ghi nhật ký request. Truyền vào để test thu lại được thay vì bẩn stdout. */
  readonly log?: LogSink;
}

interface Vars {
  nonce: string;
  /**
   * Ai gọi request này — do route tự đặt khi đã tra phiên.
   *
   * Middleware nhật ký chạy TRƯỚC route nên không tự tra được, và tra thêm một lần nữa ở
   * middleware là đọc DB hai lần cho mỗi request chỉ để ghi một dòng log.
   */
  userId: string | null;
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

  const log = config.log ?? stdoutSink;

  app.use('*', async (c, next) => {
    // Nonce MỚI cho từng request. Dùng lại một nonce cố định thì nó không còn là nonce,
    // và CSP trở lại ngang mức `unsafe-inline`.
    const nonce = randomBytes(16).toString('base64');
    c.set('nonce', nonce);
    c.set('userId', null);

    // Mã request ngắn, đủ để nối một lỗi trên màn hình với một dòng nhật ký.
    const id = randomBytes(6).toString('hex');
    const startedAt = Date.now();

    try {
      await next();
    } finally {
      // `finally`: request ném ra giữa chừng cũng phải để lại vết. Đó chính là loại
      // request mà sau này người ta đi tìm.
      log({
        at: now(),
        id,
        method: c.req.method,
        path: redactPath(c.req.path),
        status: c.res.status,
        ms: Date.now() - startedAt,
        userId: c.get('userId'),
      });
    }
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
    // Ghi ai vừa vào. Không có dòng này thì nhật ký chỉ nói "có người đăng nhập thành
    // công" — đúng nhưng vô dụng, vì câu cần trả lời khi truy nguyên luôn là "ai".
    // Lần đăng nhập HỎNG vẫn để `null`: chưa xác thực được thì chưa biết là ai, và ghi
    // theo email người ta gõ vào là ghi lại một lời khai chưa kiểm chứng.
    c.set('userId', result.user.userId);
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
    c.set('userId', user.userId);
    return c.json({ user });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  /**
   * S7 — tải báo cáo Excel (§11).
   *
   * Route HTTP thường chứ không phải procedure tRPC: đây là một FILE NHỊ PHÂN. Nhét
   * buffer qua tRPC thì phải mã hoá base64, phình một phần ba, và trình duyệt vẫn không
   * tải xuống được nếu không có `Content-Disposition`. Một GET với header đúng thì thẻ
   * `<a download>` làm được ngay.
   */
  app.get('/api/export', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const user = sessionId === undefined ? null : getSession(config.db, sessionId, now());
    if (user === null) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', user.userId);

    const projectId = c.req.query('project') ?? '';
    const report = c.req.query('report') ?? '';
    if (!['full', 'summary', 'resource'].includes(report)) {
      return c.json({ error: 'invalid_report' }, 400);
    }

    const assignment = findProjectRole(config.db, user.userId, projectId);
    try {
      // §10.6 cho lead bản `full` thôi, nên `reportKind` phải đi kèm — thiếu nó là mở
      // cửa cho lead tải bản `resource` (ma trận năng lực toàn đội).
      assertCan('export_report', {
        isAdmin: user.isAdmin,
        projectRole: assignment?.role ?? null,
        reportKind: report as ReportKind,
      });
    } catch (e) {
      if (e instanceof ForbiddenError) return c.json({ error: 'forbidden' }, 403);
      throw e;
    }

    const rawDepth = c.req.query('depth');
    const depth = rawDepth === undefined ? undefined : Number(rawDepth);
    if (depth !== undefined && !Number.isInteger(depth)) {
      return c.json({ error: 'invalid_depth' }, 400);
    }

    try {
      const result = await exportExcel(config.db, {
        projectId,
        report: report as ReportKind,
        runId: `export-${now()}`,
        ...(depth === undefined ? {} : { depth }),
      });
      c.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      c.header('content-disposition', `attachment; filename="${result.filename}"`);
      // §11.4: Major vẫn xuất, nhưng người tải phải biết. Header thay vì chèn vào file —
      // sửa nội dung file là làm hỏng chính thứ §14.5 so byte-for-byte.
      c.header('x-planix-warnings', String(result.warnings.length));
      return c.body(new Uint8Array(result.buffer));
    } catch (error) {
      if (error instanceof ExportBlockedError) {
        return c.json(
          {
            error: 'blocked',
            issues: error.report.issues.filter((i) => i.severity === 'Critical'),
          },
          409,
        );
      }
      return c.json({ error: error instanceof Error ? error.message : 'export_failed' }, 400);
    }
  });

  // ── tRPC ──────────────────────────────────────────────────────────────────
  app.all('/trpc/*', (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const user = sessionId === undefined ? null : getSession(config.db, sessionId, now());
    c.set('userId', user?.userId ?? null);

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
