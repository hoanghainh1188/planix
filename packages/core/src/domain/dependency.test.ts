import { describe, expect, it } from 'vitest';
import {
  bridgeCancelled,
  buildVirtualEdges,
  expandSummaryEdges,
  type DepEdge,
  type DepTask,
} from './dependency.js';

function t(uid: string, over: Partial<DepTask> = {}): DepTask {
  return {
    uid,
    parentUid: null,
    sortOrder: 1,
    depth: 1,
    kind: 'work',
    childSequencing: null,
    status: 'not_started',
    ...over,
  };
}

function e(predUid: string, succUid: string, type: DepEdge['type'] = 'FS', lagDays = 0): DepEdge {
  return { predUid, succUid, type, lagDays };
}

// ── §6.3 cạnh ảo của cụm sequential ─────────────────────────────────────────

describe('buildVirtualEdges — chuỗi tuần tự tự động (§6.3)', () => {
  it('cụm sequential sinh FS giữa các con liên tiếp theo sort_order', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: 'sequential' }),
      t('c2', { parentUid: 'S', sortOrder: 2, depth: 2 }),
      t('c1', { parentUid: 'S', sortOrder: 1, depth: 2 }),
      t('c3', { parentUid: 'S', sortOrder: 3, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([
      { predUid: 'c1', succUid: 'c2', type: 'FS', lagDays: 0 },
      { predUid: 'c2', succUid: 'c3', type: 'FS', lagDays: 0 },
    ]);
  });

  it('mặc định là parallel — NULL không sinh cạnh nào (§6.3)', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: null }),
      t('c1', { parentUid: 'S', sortOrder: 1, depth: 2 }),
      t('c2', { parentUid: 'S', sortOrder: 2, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([]);
  });

  it('parallel khai tường minh cũng không sinh cạnh', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: 'parallel' }),
      t('c1', { parentUid: 'S', sortOrder: 1, depth: 2 }),
      t('c2', { parentUid: 'S', sortOrder: 2, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([]);
  });

  it('sort_order hoà thì phân định bằng uid — kết quả phải tái lập (N2)', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: 'sequential' }),
      t('b', { parentUid: 'S', sortOrder: 1, depth: 2 }),
      t('a', { parentUid: 'S', sortOrder: 1, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([
      { predUid: 'a', succUid: 'b', type: 'FS', lagDays: 0 },
    ]);
  });

  it('con đã huỷ không nằm trong chuỗi', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: 'sequential' }),
      t('c1', { parentUid: 'S', sortOrder: 1, depth: 2 }),
      t('c2', { parentUid: 'S', sortOrder: 2, depth: 2, status: 'cancelled' }),
      t('c3', { parentUid: 'S', sortOrder: 3, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([
      { predUid: 'c1', succUid: 'c3', type: 'FS', lagDays: 0 },
    ]);
  });

  it('cụm chỉ có một con thì không có cạnh', () => {
    const tasks = [
      t('S', { kind: 'summary', childSequencing: 'sequential' }),
      t('c1', { parentUid: 'S', sortOrder: 1, depth: 2 }),
    ];
    expect(buildVirtualEdges(tasks)).toEqual([]);
  });
});

// ── §6.5 bắc cầu khi task bị huỷ ────────────────────────────────────────────

describe('bridgeCancelled — bảng §6.5', () => {
  const tasks = [t('A'), t('B', { status: 'cancelled' }), t('C')];

  it('FS + FS bắc cầu thành FS, lag cộng dồn', () => {
    const { edges, issues } = bridgeCancelled(tasks, [e('A', 'B', 'FS', 1), e('B', 'C', 'FS', 2)]);
    expect(edges).toEqual([{ predUid: 'A', succUid: 'C', type: 'FS', lagDays: 3 }]);
    expect(issues).toEqual([]);
  });

  it('FS + SS bắc cầu thành FS', () => {
    const { edges } = bridgeCancelled(tasks, [e('A', 'B', 'FS', 1), e('B', 'C', 'SS', 1)]);
    expect(edges).toEqual([{ predUid: 'A', succUid: 'C', type: 'FS', lagDays: 2 }]);
  });

  it('SS + SS bắc cầu thành SS', () => {
    const { edges } = bridgeCancelled(tasks, [e('A', 'B', 'SS', 1), e('B', 'C', 'SS', 2)]);
    expect(edges).toEqual([{ predUid: 'A', succUid: 'C', type: 'SS', lagDays: 3 }]);
  });

  it('FF + FF bắc cầu thành FF', () => {
    const { edges } = bridgeCancelled(tasks, [e('A', 'B', 'FF', 0), e('B', 'C', 'FF', 1)]);
    expect(edges).toEqual([{ predUid: 'A', succUid: 'C', type: 'FF', lagDays: 1 }]);
  });

  it('SS + FF KHÔNG bắc cầu — bỏ liên kết và ghi N07 (§6.5)', () => {
    const { edges, issues } = bridgeCancelled(tasks, [e('A', 'B', 'SS', 0), e('B', 'C', 'FF', 0)]);
    expect(edges).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('N07');
    expect(issues[0]?.severity).toBe('Minor');
  });

  it('SF dính vào cũng không bắc cầu', () => {
    const { edges, issues } = bridgeCancelled(tasks, [e('A', 'B', 'SF', 0), e('B', 'C', 'SF', 0)]);
    expect(edges).toEqual([]);
    expect(issues[0]?.code).toBe('N07');
  });

  it('bắc cầu ĐỆ QUY: huỷ liên tiếp B rồi C thì A nối thẳng tới D (§6.5)', () => {
    const chain = [
      t('A'),
      t('B', { status: 'cancelled' }),
      t('C', { status: 'cancelled' }),
      t('D'),
    ];
    const { edges } = bridgeCancelled(chain, [
      e('A', 'B', 'FS', 1),
      e('B', 'C', 'FS', 1),
      e('C', 'D', 'FS', 1),
    ]);
    expect(edges).toEqual([{ predUid: 'A', succUid: 'D', type: 'FS', lagDays: 3 }]);
  });

  it('không có task huỷ thì giữ nguyên cạnh', () => {
    const ok = [t('A'), t('B'), t('C')];
    const input = [e('A', 'B'), e('B', 'C')];
    expect(bridgeCancelled(ok, input).edges).toEqual(input);
  });

  it('task huỷ ở ĐẦU chuỗi thì bỏ cạnh, không bắc cầu được', () => {
    const head = [t('A', { status: 'cancelled' }), t('B')];
    const { edges } = bridgeCancelled(head, [e('A', 'B')]);
    expect(edges).toEqual([]);
  });

  it('bỏ huỷ B thì mọi thứ khôi phục — cạnh ảo tính lúc chạy, không ghi DB (§6.5)', () => {
    const restored = [t('A'), t('B'), t('C')];
    const input = [e('A', 'B', 'FS', 1), e('B', 'C', 'FS', 2)];
    expect(bridgeCancelled(restored, input).edges).toEqual(input);
  });
});

// ── §6.2 mở rộng ràng buộc summary sang lá ──────────────────────────────────

describe('expandSummaryEdges — summary sang lá (§6.2)', () => {
  const tree = [
    t('A', { kind: 'summary' }),
    t('a1', { parentUid: 'A', depth: 2 }),
    t('a2', { parentUid: 'A', depth: 2, sortOrder: 2 }),
    t('B', { kind: 'summary', sortOrder: 2 }),
    t('b1', { parentUid: 'B', depth: 2 }),
    t('b2', { parentUid: 'B', depth: 2, sortOrder: 2 }),
  ];

  it('A --FS--> B thành mọi lá của B phụ thuộc mọi lá của A', () => {
    const out = expandSummaryEdges(tree, [e('A', 'B', 'FS', 2)]);
    expect(out).toEqual([
      { predUid: 'a1', succUid: 'b1', type: 'FS', lagDays: 2 },
      { predUid: 'a1', succUid: 'b2', type: 'FS', lagDays: 2 },
      { predUid: 'a2', succUid: 'b1', type: 'FS', lagDays: 2 },
      { predUid: 'a2', succUid: 'b2', type: 'FS', lagDays: 2 },
    ]);
  });

  it('cạnh giữa hai lá giữ nguyên, không nhân bản', () => {
    const out = expandSummaryEdges(tree, [e('a1', 'a2')]);
    expect(out).toEqual([{ predUid: 'a1', succUid: 'a2', type: 'FS', lagDays: 0 }]);
  });

  it('lá đã huỷ bị loại khỏi kết quả mở rộng', () => {
    const withCancel = tree.map((x) =>
      x.uid === 'a1' ? { ...x, status: 'cancelled' as const } : x,
    );
    const out = expandSummaryEdges(withCancel, [e('A', 'B')]);
    expect(out.every((edge) => edge.predUid !== 'a1')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('summary rỗng (không có lá) thì không sinh cạnh nào', () => {
    const empty = [t('A', { kind: 'summary' }), t('B', { kind: 'summary', sortOrder: 2 })];
    expect(expandSummaryEdges(empty, [e('A', 'B')])).toEqual([]);
  });

  it('cây sâu: lá ở cấp 3 vẫn được gom đúng', () => {
    const deep = [
      t('A', { kind: 'summary' }),
      t('A1', { parentUid: 'A', kind: 'summary', depth: 2 }),
      t('leaf', { parentUid: 'A1', depth: 3 }),
      t('B', { kind: 'summary', sortOrder: 2 }),
      t('b1', { parentUid: 'B', depth: 2 }),
    ];
    expect(expandSummaryEdges(deep, [e('A', 'B')])).toEqual([
      { predUid: 'leaf', succUid: 'b1', type: 'FS', lagDays: 0 },
    ]);
  });

  it('kết quả sắp ổn định, không phụ thuộc thứ tự đầu vào (N2)', () => {
    const shuffled = [...tree].reverse();
    expect(expandSummaryEdges(shuffled, [e('A', 'B')])).toEqual(
      expandSummaryEdges(tree, [e('A', 'B')]),
    );
  });
});
