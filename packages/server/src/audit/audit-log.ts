/**
 * Nhật ký thay đổi — SPEC.md §4.2 bảng `audit_log`, §14.2 P7.
 *
 * Ghi theo TỪNG TRƯỜNG, không ghi cả bản ghi dạng JSON. Bảng §4.2 có `field`,
 * `old_value`, `new_value` là số ít, và đó là thứ trả lời được câu hỏi PM thật sự hỏi:
 * "ai đổi effort của task này từ 3 thành 8, và lúc nào".
 *
 * Ghi một cục JSON thì phải tự đi so hai bản để biết cái gì đổi.
 */

import type { Db } from '@planix/core/db/migrate.js';
import * as repo from '@planix/core/db/repo/auth-repo.js';

export type { Db };
export type AuditAction = 'create' | 'update' | 'delete';

/** Các thực thể §14.2 P7 bắt buộc ghi vết. */
export type AuditEntity = 'task' | 'dependency' | 'progress' | 'resource';

export interface AuditContext {
  readonly userId: string;
  readonly at: string;
}

/**
 * Đọc một object bất kỳ như bản ghi khoá-giá trị.
 *
 * `as` ở đây có lý do, không phải để im lặng trình biên dịch: interface trong TypeScript
 * không có index signature ngầm, nên một `interface Foo { name: string }` không gán được
 * vào `Record<string, unknown>` dù về giá trị thì hoàn toàn hợp lệ. Nhận `object` rồi
 * chuyển ở đây là cách để người gọi truyền interface của họ mà không phải tự ép kiểu.
 */
function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Ghi thay đổi giữa hai trạng thái của một bản ghi.
 *
 * Trường nào không đổi thì KHÔNG ghi dòng nào: nhật ký đầy dòng "không đổi" là nhật ký
 * không ai đọc. Trả về số dòng đã ghi.
 */
export function recordUpdate(
  db: Db,
  ctx: AuditContext,
  entity: AuditEntity,
  entityId: string,
  beforeInput: Readonly<object>,
  afterInput: Readonly<object>,
): number {
  const before = asRecord(beforeInput);
  const after = asRecord(afterInput);
  // Duyệt theo tên trường đã sắp: thứ tự dòng nhật ký không nên phụ thuộc thứ tự khoá
  // của object, thứ thay đổi theo cách người gọi dựng dữ liệu.
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  let written = 0;

  for (const field of fields) {
    const oldValue = toText(before[field]);
    const newValue = toText(after[field]);
    if (oldValue === newValue) continue;
    repo.insertAuditRow(db, {
      at: ctx.at,
      userId: ctx.userId,
      entity,
      entityId,
      action: 'update',
      field,
      oldValue,
      newValue,
    });
    written++;
  }
  return written;
}

/** Ghi việc tạo mới. Một dòng, không liệt kê từng trường — chưa có gì để so. */
export function recordCreate(
  db: Db,
  ctx: AuditContext,
  entity: AuditEntity,
  entityId: string,
): void {
  repo.insertAuditRow(db, {
    at: ctx.at,
    userId: ctx.userId,
    entity,
    entityId,
    action: 'create',
    field: null,
    oldValue: null,
    newValue: null,
  });
}

export function recordDelete(
  db: Db,
  ctx: AuditContext,
  entity: AuditEntity,
  entityId: string,
): void {
  repo.insertAuditRow(db, {
    at: ctx.at,
    userId: ctx.userId,
    entity,
    entityId,
    action: 'delete',
    field: null,
    oldValue: null,
    newValue: null,
  });
}

export interface AuditRow {
  readonly at: string;
  readonly userId: string;
  readonly entity: string;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/** Lịch sử của một bản ghi, cũ trước mới sau. */
export function historyOf(db: Db, entity: AuditEntity, entityId: string): AuditRow[] {
  return repo.selectAuditHistory(db, entity, entityId);
}
