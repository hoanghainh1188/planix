import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { historyOf, recordCreate, recordDelete, recordUpdate } from '../src/audit/audit-log.js';

const AT = '2026-09-13T09:00:00.000Z';
const ctx = { userId: 'U-1', at: AT };
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES ('U-1','pm@x.com','PM','h',?)`,
  ).run(AT);
});
afterEach(() => db.close());

describe('recordUpdate — ghi theo từng trường (§4.2)', () => {
  it('ghi một dòng cho mỗi trường thật sự đổi', () => {
    const n = recordUpdate(
      db,
      ctx,
      'task',
      'T-1',
      { effort_md: 3, name: 'Cu', role: 'Dev' },
      { effort_md: 8, name: 'Moi', role: 'Dev' },
    );
    expect(n).toBe(2);

    const rows = historyOf(db, 'task', 'T-1');
    expect(rows.map((r) => r.field)).toEqual(['effort_md', 'name']);
    expect(rows[0]).toMatchObject({ field: 'effort_md', oldValue: '3', newValue: '8' });
  });

  it('KHÔNG ghi dòng nào cho trường không đổi', () => {
    const n = recordUpdate(db, ctx, 'task', 'T-1', { a: 1, b: 2 }, { a: 1, b: 2 });
    expect(n).toBe(0);
    expect(historyOf(db, 'task', 'T-1')).toEqual([]);
  });

  it('trả lời được câu hỏi PM hỏi: ai đổi, từ gì sang gì, lúc nào', () => {
    recordUpdate(db, ctx, 'task', 'T-1', { effort_md: 3 }, { effort_md: 8 });
    const [row] = historyOf(db, 'task', 'T-1');
    expect(row).toMatchObject({
      userId: 'U-1',
      at: AT,
      field: 'effort_md',
      oldValue: '3',
      newValue: '8',
      action: 'update',
    });
  });

  it('null và giá trị được phân biệt đúng', () => {
    recordUpdate(db, ctx, 'task', 'T-1', { role: null }, { role: 'Dev' });
    recordUpdate(db, ctx, 'task', 'T-2', { role: 'Dev' }, { role: null });
    expect(historyOf(db, 'task', 'T-1')[0]).toMatchObject({ oldValue: null, newValue: 'Dev' });
    expect(historyOf(db, 'task', 'T-2')[0]).toMatchObject({ oldValue: 'Dev', newValue: null });
  });

  it('trường chỉ có ở một bên vẫn được ghi', () => {
    recordUpdate(db, ctx, 'task', 'T-1', {}, { phase: 'Design' });
    expect(historyOf(db, 'task', 'T-1')[0]).toMatchObject({
      field: 'phase',
      oldValue: null,
      newValue: 'Design',
    });
  });

  it('thứ tự dòng theo tên trường, không theo thứ tự khoá của object', () => {
    recordUpdate(db, ctx, 'task', 'T-1', { z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
    expect(historyOf(db, 'task', 'T-1').map((r) => r.field)).toEqual(['a', 'm', 'z']);
  });

  it('số và boolean được chuyển thành text đọc được', () => {
    recordUpdate(db, ctx, 'task', 'T-1', { n: 1, b: false }, { n: 2, b: true });
    const rows = historyOf(db, 'task', 'T-1');
    expect(rows.find((r) => r.field === 'b')).toMatchObject({
      oldValue: 'false',
      newValue: 'true',
    });
  });
});

describe('create và delete', () => {
  it('ghi một dòng, không liệt kê từng trường', () => {
    recordCreate(db, ctx, 'dependency', 'D-1');
    recordDelete(db, ctx, 'dependency', 'D-1');
    const rows = historyOf(db, 'dependency', 'D-1');
    expect(rows.map((r) => r.action)).toEqual(['create', 'delete']);
    expect(rows.every((r) => r.field === null)).toBe(true);
  });
});

describe('§14.2 P7 — phủ đủ bốn thực thể bắt buộc', () => {
  it('task, dependency, progress, resource đều ghi được', () => {
    for (const entity of ['task', 'dependency', 'progress', 'resource'] as const) {
      recordUpdate(db, ctx, entity, `${entity}-1`, { x: 1 }, { x: 2 });
      expect(historyOf(db, entity, `${entity}-1`)).toHaveLength(1);
    }
  });

  it('lịch sử của thực thể này không lẫn sang thực thể khác', () => {
    recordUpdate(db, ctx, 'task', 'X', { a: 1 }, { a: 2 });
    recordUpdate(db, ctx, 'progress', 'X', { a: 1 }, { a: 3 });
    expect(historyOf(db, 'task', 'X')).toHaveLength(1);
    expect(historyOf(db, 'progress', 'X')[0]?.newValue).toBe('3');
  });
});
