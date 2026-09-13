import { describe, expect, it } from 'vitest';
import { buildClusters, type DepEdge, type DepTask } from './dependency.js';

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

/** Cây: root(1) > ph0,ph1(2) > mod(3) > lá(4) */
const tree: DepTask[] = [
  t('root', { kind: 'summary', depth: 1 }),
  t('ph0', { kind: 'summary', depth: 2, parentUid: 'root' }),
  t('ph0m0', { kind: 'summary', depth: 3, parentUid: 'ph0' }),
  t('a1', { depth: 4, parentUid: 'ph0m0' }),
  t('a2', { depth: 4, parentUid: 'ph0m0', sortOrder: 2 }),
  t('ph1', { kind: 'summary', depth: 2, parentUid: 'root', sortOrder: 2 }),
  t('ph1m0', { kind: 'summary', depth: 3, parentUid: 'ph1' }),
  t('b1', { depth: 4, parentUid: 'ph1m0' }),
];

describe('buildClusters (§6.2, §7.3 bước 1)', () => {
  it('cụm là summary SÂU NHẤT trong giới hạn, không phải mọi summary', () => {
    const out = buildClusters(tree, [], 3);
    expect(out.map((c) => c.uid)).toEqual(['ph0m0', 'ph1m0']);
  });

  it('mỗi lá thuộc đúng một cụm — không xếp hai lần', () => {
    const out = buildClusters(tree, [], 3);
    const all = out.flatMap((c) => c.leafUids);
    expect(all.sort()).toEqual(['a1', 'a2', 'b1']);
    expect(new Set(all).size).toBe(all.length);
  });

  it('maxLevel 2 thì cụm lùi lên cấp phase, lá cấp 4 vẫn gom đủ', () => {
    const out = buildClusters(tree, [], 2);
    expect(out.map((c) => c.uid)).toEqual(['ph0', 'ph1']);
    expect(out[0]?.leafUids).toEqual(['a1', 'a2']);
  });

  it('cạnh khai ở cấp phase được nâng lên mức cụm và quyết định thứ tự', () => {
    const edges: DepEdge[] = [{ predUid: 'ph1', succUid: 'ph0', type: 'FS', lagDays: 0 }];
    expect(buildClusters(tree, edges, 3).map((c) => c.uid)).toEqual(['ph1m0', 'ph0m0']);
  });

  it('cạnh nội bộ trong cùng cụm bị bỏ qua, không tạo phụ thuộc giả', () => {
    const edges: DepEdge[] = [{ predUid: 'a1', succUid: 'a2', type: 'FS', lagDays: 0 }];
    expect(buildClusters(tree, edges, 3).map((c) => c.uid)).toEqual(['ph0m0', 'ph1m0']);
  });

  it('lá đã huỷ không nằm trong cụm', () => {
    const withCancel = tree.map((x) =>
      x.uid === 'a1' ? { ...x, status: 'cancelled' as const } : x,
    );
    expect(buildClusters(withCancel, [], 3)[0]?.leafUids).toEqual(['a2']);
  });

  it('vòng lặp giữa các cụm thì ném lỗi', () => {
    const edges: DepEdge[] = [
      { predUid: 'ph0', succUid: 'ph1', type: 'FS', lagDays: 0 },
      { predUid: 'ph1', succUid: 'ph0', type: 'FS', lagDays: 0 },
    ];
    expect(() => buildClusters(tree, edges, 3)).toThrow(/cycle/i);
  });

  it('cây không có summary nào thì gom tất cả lá thành một cụm', () => {
    const flat = [t('x'), t('y')];
    expect(buildClusters(flat, [], 3)).toEqual([{ uid: '<all>', leafUids: ['x', 'y'] }]);
  });

  it('thứ tự đầu vào không ảnh hưởng kết quả (N2)', () => {
    expect(buildClusters([...tree].reverse(), [], 3)).toEqual(buildClusters(tree, [], 3));
  });
});
