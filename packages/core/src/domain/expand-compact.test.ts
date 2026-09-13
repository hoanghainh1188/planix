import { describe, expect, it } from 'vitest';
import {
  expandSummaryEdges,
  expandSummaryEdgesCompact,
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

function bigTree(leavesPerSide: number): DepTask[] {
  const out: DepTask[] = [t('A', { kind: 'summary' }), t('B', { kind: 'summary', sortOrder: 2 })];
  for (let i = 0; i < leavesPerSide; i++) {
    out.push(t(`a${i}`, { parentUid: 'A', depth: 2, sortOrder: i }));
    out.push(t(`b${i}`, { parentUid: 'B', depth: 2, sortOrder: i }));
  }
  return out;
}

const edge: DepEdge = { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 2 };

describe('expandSummaryEdgesCompact — không nở tích Descartes (§6.2)', () => {
  it('100 lá mỗi bên: 200 cạnh thay vì 10.000', () => {
    const tasks = bigTree(100);
    const naive = expandSummaryEdges(tasks, [edge]);
    const compact = expandSummaryEdgesCompact(tasks, [edge]);

    expect(naive).toHaveLength(10_000);
    expect(compact.edges).toHaveLength(200);
    expect(compact.syntheticNodes).toHaveLength(1);
  });

  it('nút gộp nối MỌI lá của A vào và MỌI lá của B ra', () => {
    const tasks = bigTree(3);
    const { edges, syntheticNodes } = expandSummaryEdgesCompact(tasks, [edge]);
    const join = syntheticNodes[0]?.uid;
    expect(join).toBeDefined();

    const into = edges
      .filter((e) => e.succUid === join)
      .map((e) => e.predUid)
      .sort();
    const outOf = edges
      .filter((e) => e.predUid === join)
      .map((e) => e.succUid)
      .sort();
    expect(into).toEqual(['a0', 'a1', 'a2']);
    expect(outOf).toEqual(['b0', 'b1', 'b2']);
  });

  it('lag chỉ cộng MỘT lần, ở vế sau nút gộp', () => {
    const tasks = bigTree(2);
    const { edges, syntheticNodes } = expandSummaryEdgesCompact(tasks, [edge]);
    const join = syntheticNodes[0]?.uid;
    expect(edges.filter((e) => e.succUid === join).every((e) => e.lagDays === 0)).toBe(true);
    expect(edges.filter((e) => e.predUid === join).every((e) => e.lagDays === 2)).toBe(true);
  });

  it('bên chỉ có một lá thì nối thẳng, không chèn nút gộp', () => {
    const tasks = [
      t('A', { kind: 'summary' }),
      t('a1', { parentUid: 'A', depth: 2 }),
      t('B', { kind: 'summary', sortOrder: 2 }),
      t('b1', { parentUid: 'B', depth: 2 }),
      t('b2', { parentUid: 'B', depth: 2, sortOrder: 2 }),
    ];
    const { edges, syntheticNodes } = expandSummaryEdgesCompact(tasks, [edge]);
    expect(syntheticNodes).toHaveLength(0);
    expect(edges).toHaveLength(2);
  });

  it('tên nút gộp tái lập được, không phụ thuộc thứ tự đầu vào (N2)', () => {
    const tasks = bigTree(3);
    const edges: DepEdge[] = [
      { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
      { predUid: 'B', succUid: 'A', type: 'SS', lagDays: 1 },
    ];
    const a = expandSummaryEdgesCompact(tasks, edges);
    const b = expandSummaryEdgesCompact(tasks, [...edges].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('summary rỗng thì không sinh cạnh nào', () => {
    const tasks = [t('A', { kind: 'summary' }), t('B', { kind: 'summary', sortOrder: 2 })];
    expect(expandSummaryEdgesCompact(tasks, [edge]).edges).toEqual([]);
  });
});
