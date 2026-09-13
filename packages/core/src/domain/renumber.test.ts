import { describe, expect, it } from 'vitest';
import { renumber, type TaskNode } from './renumber.js';

/** Dựng node gọn cho test. */
function n(uid: string, parentUid: string | null, sortOrder: number): TaskNode {
  return { uid, parentUid, sortOrder };
}

/** Đảo thứ tự mảng theo một hoán vị cố định — KHÔNG dùng random (N2). */
function rotate<T>(xs: readonly T[], by: number): T[] {
  const k = ((by % xs.length) + xs.length) % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}

describe('renumber — cây rỗng và suy biến', () => {
  it('cây rỗng trả về mảng rỗng', () => {
    expect(renumber([])).toEqual([]);
  });

  it('một gốc duy nhất là 1, depth 1', () => {
    expect(renumber([n('T-1', null, 10)])).toEqual([{ uid: 'T-1', wbsCode: '1', depth: 1 }]);
  });
});

describe('renumber — sinh mã theo DFS (§9.4)', () => {
  it('sinh 1, 1.1, 1.1.1 theo đúng chiều sâu', () => {
    const tasks = [n('A', null, 1), n('B', 'A', 1), n('C', 'B', 1)];
    expect(renumber(tasks)).toEqual([
      { uid: 'A', wbsCode: '1', depth: 1 },
      { uid: 'B', wbsCode: '1.1', depth: 2 },
      { uid: 'C', wbsCode: '1.1.1', depth: 3 },
    ]);
  });

  it('anh em sắp theo sort_order tăng dần', () => {
    const tasks = [n('R', null, 1), n('X', 'R', 30), n('Y', 'R', 10), n('Z', 'R', 20)];
    const out = renumber(tasks);
    expect(out.map((t) => [t.uid, t.wbsCode])).toEqual([
      ['R', '1'],
      ['Y', '1.1'],
      ['Z', '1.2'],
      ['X', '1.3'],
    ]);
  });

  it('nhiều gốc được đánh 1, 2, 3 theo sort_order', () => {
    const tasks = [n('P', null, 20), n('Q', null, 10)];
    expect(renumber(tasks).map((t) => [t.uid, t.wbsCode])).toEqual([
      ['Q', '1'],
      ['P', '2'],
    ]);
  });

  it('trả về theo thứ tự DFS, không phải thứ tự đầu vào', () => {
    const tasks = [n('A', null, 1), n('A2', 'A', 2), n('A1', 'A', 1), n('A1a', 'A1', 1)];
    expect(renumber(tasks).map((t) => t.uid)).toEqual(['A', 'A1', 'A1a', 'A2']);
  });
});

describe('renumber — tie-break bằng uid (§9.4, điều kiện N2)', () => {
  it('sort_order bằng nhau thì phân định bằng uid tăng dần', () => {
    const tasks = [n('R', null, 1), n('T-b', 'R', 5), n('T-a', 'R', 5), n('T-c', 'R', 5)];
    expect(renumber(tasks).map((t) => [t.uid, t.wbsCode])).toEqual([
      ['R', '1'],
      ['T-a', '1.1'],
      ['T-b', '1.2'],
      ['T-c', '1.3'],
    ]);
  });
});

describe('renumber — tính tái lập (M2)', () => {
  const tasks = [
    n('R1', null, 1),
    n('R2', null, 2),
    n('A', 'R1', 2),
    n('B', 'R1', 1),
    n('A1', 'A', 1),
    n('A2', 'A', 1),
    n('C', 'R2', 1),
  ];

  it('chạy 2 lần ra kết quả giống hệt (§14.2 P1)', () => {
    expect(renumber(tasks)).toEqual(renumber(tasks));
  });

  it('thứ tự mảng đầu vào KHÔNG ảnh hưởng kết quả', () => {
    const base = JSON.stringify(renumber(tasks));
    for (let by = 1; by < tasks.length; by++) {
      expect(JSON.stringify(renumber(rotate(tasks, by)))).toBe(base);
    }
  });
});

describe('renumber — đầu vào hỏng thì ném lỗi, không sinh cây sai', () => {
  it('parent_uid trỏ tới uid không tồn tại (tiền đề của C02)', () => {
    expect(() => renumber([n('A', 'KHONG-CO', 1)])).toThrow(/KHONG-CO/);
  });

  it('task tự làm cha chính nó (tiền đề của C08)', () => {
    expect(() => renumber([n('A', 'A', 1)])).toThrow(/A/);
  });

  it('vòng lặp cha-con nhiều bước không làm treo hàm', () => {
    expect(() => renumber([n('A', 'B', 1), n('B', 'A', 1)])).toThrow();
  });

  it('uid trùng nhau', () => {
    expect(() => renumber([n('A', null, 1), n('A', null, 2)])).toThrow(/A/);
  });
});
