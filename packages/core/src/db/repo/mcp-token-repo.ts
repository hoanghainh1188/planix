/**
 * Token cho lớp MCP — SPEC.md §12.4.
 *
 * Token là 32 byte ngẫu nhiên, chỉ hiện MỘT lần lúc tạo; DB chỉ giữ SHA-256 của nó. Mất
 * token thì cấp cái mới, không có đường đọc lại — cùng nguyên tắc với mật khẩu, khác ở
 * chỗ không cần KDF chậm vì token không phải thứ người ta nghĩ ra.
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3); prepared statement, không nối chuỗi.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../migrate.js';

/** Tiền tố để token lộ ra trong log hay lịch sử shell thì nhìn là biết ngay của ai. */
const TOKEN_PREFIX = 'planix_mcp_';

export interface McpTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface CreatedToken {
  readonly id: string;
  /** Chỉ trả về ở đây, đúng một lần. DB không giữ bản rõ. */
  readonly token: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createMcpToken(
  db: Db,
  params: { readonly userId: string; readonly label: string; readonly now: string },
): CreatedToken {
  const id = `MCP-${randomBytes(8).toString('hex')}`;
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

  db.prepare(
    `INSERT INTO mcp_token (id, user_id, label, token_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, params.userId, params.label, hashToken(token), params.now);

  return { id, token };
}

export interface McpPrincipal {
  readonly tokenId: string;
  readonly userId: string;
  readonly isAdmin: boolean;
}

/**
 * Đổi bearer token lấy người dùng đứng sau nó. `null` nếu token sai hoặc đã thu hồi.
 *
 * So bằng `timingSafeEqual` trên chuỗi hash, không bằng `===`: hai chuỗi khác nhau ở byte
 * đầu thoát sớm hơn hai chuỗi khác nhau ở byte cuối, và chênh lệch đó đo được qua mạng.
 * Ở đây tra bằng chỉ mục trên `token_hash` nên đã gần như không rò, nhưng chỗ so sánh
 * cuối vẫn làm đúng — rẻ, và không phải nhớ lại vì sao khi ai đó đổi câu truy vấn.
 */
export function resolveMcpToken(db: Db, token: string, now: string): McpPrincipal | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const digest = hashToken(token);

  const row = db
    .prepare(
      `SELECT t.id, t.user_id, t.token_hash, t.revoked_at, u.is_admin
         FROM mcp_token t JOIN app_user u ON u.id = t.user_id
        WHERE t.token_hash = ?`,
    )
    .get(digest) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  if ((row['revoked_at'] as string | null) !== null) return null;

  const stored = Buffer.from(row['token_hash'] as string, 'utf8');
  const given = Buffer.from(digest, 'utf8');
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;

  // Ghi lần dùng gần nhất: khi cần thu hồi bớt token cũ, đây là thứ duy nhất nói cái nào
  // còn ai dùng.
  db.prepare('UPDATE mcp_token SET last_used_at = ? WHERE id = ?').run(now, row['id']);

  return {
    tokenId: row['id'] as string,
    userId: row['user_id'] as string,
    isAdmin: (row['is_admin'] as number) === 1,
  };
}

export function listMcpTokens(db: Db): McpTokenRow[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, label, created_at, last_used_at, revoked_at
         FROM mcp_token ORDER BY created_at DESC, id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r['id'] as string,
    userId: r['user_id'] as string,
    label: r['label'] as string,
    createdAt: r['created_at'] as string,
    lastUsedAt: (r['last_used_at'] as string | null) ?? null,
    revokedAt: (r['revoked_at'] as string | null) ?? null,
  }));
}

/** Thu hồi, không xoá (§12.4 cần truy nguyên). Trả về số dòng thật sự vừa bị thu hồi. */
export function revokeMcpToken(db: Db, id: string, now: string): number {
  return db
    .prepare('UPDATE mcp_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(now, id).changes;
}
