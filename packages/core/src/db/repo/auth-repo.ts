/**
 * Truy vấn cho xác thực và nhật ký — SPEC.md §4.2, §13.3.
 *
 * Đặt ở đây vì `CLAUDE.md` §3 chốt: mọi truy vấn nằm trong `packages/core/src/db/repo/`.
 * Logic phiên và giới hạn đăng nhập thuộc về `packages/server`; phần chạm SQL thì không.
 */

import type { Db } from '../migrate.js';

export interface AppUserRow {
  readonly id: string;
  readonly passwordHash: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
}

export function findUserByEmail(db: Db, email: string): AppUserRow | undefined {
  const r = db
    .prepare('SELECT id, password_hash, is_admin, is_active FROM app_user WHERE email = ?')
    .get(email) as
    { id: string; password_hash: string; is_admin: number; is_active: number } | undefined;
  if (r === undefined) return undefined;
  return {
    id: r.id,
    passwordHash: r.password_hash,
    isAdmin: r.is_admin === 1,
    isActive: r.is_active === 1,
  };
}

export function insertUser(
  db: Db,
  p: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    passwordHash: string;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO app_user (id, email, name, is_admin, password_hash, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(p.id, p.email, p.name, p.isAdmin ? 1 : 0, p.passwordHash, p.now);
}

export function insertSession(
  db: Db,
  p: {
    id: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
    userAgent: string | null;
    ip: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO session (id, user_id, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.userId, p.createdAt, p.expiresAt, p.userAgent, p.ip);
}

export interface SessionRow {
  readonly userId: string;
  readonly expiresAt: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
}

export function findSession(db: Db, sessionId: string): SessionRow | undefined {
  const r = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.is_admin, u.is_active
       FROM session s JOIN app_user u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    { user_id: string; expires_at: string; is_admin: number; is_active: number } | undefined;
  if (r === undefined) return undefined;
  return {
    userId: r.user_id,
    expiresAt: r.expires_at,
    isAdmin: r.is_admin === 1,
    isActive: r.is_active === 1,
  };
}

export function deleteSession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions(db: Db, now: string): number {
  return db.prepare('DELETE FROM session WHERE expires_at <= ?').run(now).changes;
}

export function insertLoginAttempt(
  db: Db,
  p: { ip: string; email: string | null; at: string; successful: boolean },
): void {
  db.prepare('INSERT INTO login_attempt (ip, email, at, successful) VALUES (?, ?, ?, ?)').run(
    p.ip,
    p.email,
    p.at,
    p.successful ? 1 : 0,
  );
}

export function countFailedAttempts(db: Db, ip: string, since: string): number {
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM login_attempt WHERE ip = ? AND at > ? AND successful = 0')
    .get(ip, since) as { n: number };
  return r.n;
}

// ── audit_log ───────────────────────────────────────────────────────────────

export function insertAuditRow(
  db: Db,
  p: {
    at: string;
    userId: string;
    entity: string;
    entityId: string;
    action: 'create' | 'update' | 'delete';
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log (at, user_id, entity, entity_id, action, field, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.at, p.userId, p.entity, p.entityId, p.action, p.field, p.oldValue, p.newValue);
}

export interface AuditLogRow {
  readonly at: string;
  readonly userId: string;
  readonly entity: string;
  readonly entityId: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

export function selectAuditHistory(db: Db, entity: string, entityId: string): AuditLogRow[] {
  const rows = db
    .prepare(
      `SELECT at, user_id, entity, entity_id, action, field, old_value, new_value
       FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY at, id`,
    )
    .all(entity, entityId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    at: r['at'] as string,
    userId: r['user_id'] as string,
    entity: r['entity'] as string,
    entityId: r['entity_id'] as string,
    action: r['action'] as AuditLogRow['action'],
    field: (r['field'] as string | null) ?? null,
    oldValue: (r['old_value'] as string | null) ?? null,
    newValue: (r['new_value'] as string | null) ?? null,
  }));
}

/** Vai của một người trong một dự án, cho §10.6. `undefined` = không được gán. */
export function findProjectRole(
  db: Db,
  userId: string,
  projectId: string,
): { role: 'pm' | 'lead' | 'viewer'; teamId: string | null } | undefined {
  const r = db
    .prepare('SELECT role, team_id FROM user_project WHERE user_id = ? AND project_id = ?')
    .get(userId, projectId) as { role: string; team_id: string | null } | undefined;
  if (r === undefined) return undefined;
  return { role: r.role as 'pm' | 'lead' | 'viewer', teamId: r.team_id ?? null };
}

/** Dự án người này được gán, cho màn S0. */
/**
 * `statusDate` đi kèm danh sách dự án vì nó là dữ liệu CỦA DỰ ÁN (§7.13), và cả S3 lẫn S4
 * đều cần. Trước đây chỉ S4 lấy được qua `progress.board`, nên Gantt không vẽ nổi vạch
 * mốc chuẩn khi người dùng chưa mở màn nhập tiến độ.
 */
export interface UserProject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly statusDate: string;
}

export function listUserProjects(db: Db, userId: string, isAdmin: boolean): Array<UserProject> {
  if (isAdmin) {
    return db
      .prepare(
        `SELECT id, code, name, 'pm' AS role, status_date AS statusDate
         FROM project ORDER BY priority, code`,
      )
      .all() as Array<UserProject>;
  }
  return db
    .prepare(
      `SELECT p.id, p.code, p.name, up.role, p.status_date AS statusDate
       FROM project p JOIN user_project up ON up.project_id = p.id
       WHERE up.user_id = ? ORDER BY p.priority, p.code`,
    )
    .all(userId) as Array<UserProject>;
}
