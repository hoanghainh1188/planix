import { describe, expect, it } from 'vitest';
import {
  collapseAll,
  compareWbs,
  createExpandedStore,
  DEFAULT_EXPAND_DEPTH,
  defaultExpanded,
  expandAll,
  expandToDepth,
  flattenVisible,
  searchVisible,
  toggle,
  type TreeNode,
} from './tree-model.js';

function n(uid: string, wbsCode: string, parentUid: string | null, name = uid): TreeNode {
  return { uid, wbsCode, depth: wbsCode.split('.').length, parentUid, name, kind: 'work' };
}

/** Cây 4 cấp, đủ để kiểm ngưỡng "mở tới cấp 3" của §10.4. */
const tree: TreeNode[] = [
  n('R', '1', null, 'Root'),
  n('P1', '1.1', 'R', 'Phase 1'),
  n('M1', '1.1.1', 'P1', 'Module user'),
  n('L1', '1.1.1.1', 'M1', 'Design user list'),
  n('L2', '1.1.1.2', 'M1', 'Build user list'),
  n('M2', '1.1.2', 'P1', 'Module payment'),
  n('P2', '1.2', 'R', 'Phase 2'),
];

describe('flattenVisible — chỉ trả dòng THẬT SỰ hiện', () => {
  it('đóng hết thì chỉ còn gốc', () => {
    const rows = flattenVisible(tree, collapseAll());
    expect(rows.map((r) => r.node.uid)).toEqual(['R']);
  });

  it('mở hết thì ra đủ cây, theo thứ tự wbs_code', () => {
    const rows = flattenVisible(tree, expandAll(tree));
    expect(rows.map((r) => r.node.wbsCode)).toEqual([
      '1',
      '1.1',
      '1.1.1',
      '1.1.1.1',
      '1.1.1.2',
      '1.1.2',
      '1.2',
    ]);
  });

  it('node dưới tổ tiên đang đóng KHÔNG có mặt', () => {
    const rows = flattenVisible(tree, new Set(['R']));
    expect(rows.map((r) => r.node.uid)).toEqual(['R', 'P1', 'P2']);
  });

  it('đánh dấu node nào có con để biết chỗ nào vẽ nút thu gọn', () => {
    const rows = flattenVisible(tree, expandAll(tree));
    const byUid = new Map(rows.map((r) => [r.node.uid, r]));
    expect(byUid.get('M1')?.hasChildren).toBe(true);
    expect(byUid.get('L1')?.hasChildren).toBe(false);
  });

  it('thứ tự mảng đầu vào không ảnh hưởng kết quả', () => {
    const a = flattenVisible(tree, expandAll(tree)).map((r) => r.node.uid);
    const b = flattenVisible([...tree].reverse(), expandAll(tree)).map((r) => r.node.uid);
    expect(b).toEqual(a);
  });
});

describe('§10.4 — mặc định mở tới cấp 3', () => {
  it('cấp 1 và 2 mở, cấp 3 đóng, nên task lá cấp 4 không hiện', () => {
    const rows = flattenVisible(tree, defaultExpanded(tree));
    expect(rows.map((r) => r.node.wbsCode)).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.2']);
    expect(rows.some((r) => r.node.depth === 4)).toBe(false);
  });

  it('ngưỡng mặc định đúng bằng 3', () => {
    expect(DEFAULT_EXPAND_DEPTH).toBe(3);
  });

  it('với cây 4 cấp cỡ thật, lần render đầu KHÔNG đổ hết ra', () => {
    // Cây 3 cấp thì "mở tới cấp 3" đúng là hiện hết — muốn kiểm tính chất này phải có
    // cấp 4, đúng như WBS thật của §1.5 (sâu tới 6 cấp).
    const many: TreeNode[] = [n('R', '1', null)];
    for (let i = 1; i <= 2000; i++) {
      many.push(n(`M${i}`, `1.${i}`, 'R'));
      many.push(n(`G${i}`, `1.${i}.1`, `M${i}`));
      many.push(n(`L${i}`, `1.${i}.1.1`, `G${i}`));
    }
    const visible = flattenVisible(many, defaultExpanded(many));

    // Gốc + 2000 module (cấp 2) + 2000 nhóm (cấp 3). 2000 lá cấp 4 bị đóng lại.
    expect(visible.length).toBe(4001);
    expect(many.length).toBe(6001);
    expect(visible.some((r) => r.node.depth === 4)).toBe(false);
  });
});

describe('thu gọn / mở theo cấp (§10.4)', () => {
  it('expandToDepth 2 chỉ mở tới cấp 2', () => {
    const rows = flattenVisible(tree, expandToDepth(tree, 2));
    expect(rows.map((r) => r.node.wbsCode)).toEqual(['1', '1.1', '1.2']);
  });

  it('toggle mở rồi đóng lại đúng node', () => {
    const once = toggle(collapseAll(), 'R');
    expect(once.has('R')).toBe(true);
    expect(toggle(once, 'R').has('R')).toBe(false);
  });

  it('toggle không sửa tập cũ — dữ liệu bất biến', () => {
    const before = collapseAll();
    toggle(before, 'R');
    expect(before.size).toBe(0);
  });
});

describe('compareWbs — natural sort', () => {
  it('1.9 đứng trước 1.10; so chuỗi thuần sẽ sai', () => {
    expect(compareWbs('1.9', '1.10')).toBeLessThan(0);
    expect('1.9' < '1.10').toBe(false);
  });

  it('mã ngắn hơn đứng trước mã dài cùng tiền tố', () => {
    expect(compareWbs('1.2', '1.2.1')).toBeLessThan(0);
  });
});

describe('tìm kiếm (§10.4)', () => {
  it('giữ cả TỔ TIÊN để người dùng không mất ngữ cảnh', () => {
    const rows = searchVisible(tree, 'design user');
    expect(rows.map((r) => r.node.uid)).toEqual(['R', 'P1', 'M1', 'L1']);
  });

  it('không phân biệt hoa thường', () => {
    expect(searchVisible(tree, 'DESIGN').length).toBeGreaterThan(0);
  });

  it('tìm được theo tiền tố wbs_code', () => {
    const rows = searchVisible(tree, '1.1.2');
    expect(rows.map((r) => r.node.uid)).toContain('M2');
  });

  it('chuỗi rỗng trả về rỗng, không phải cả cây', () => {
    expect(searchVisible(tree, '   ')).toEqual([]);
  });

  it('không khớp gì thì rỗng', () => {
    expect(searchVisible(tree, 'khong-co-dau')).toEqual([]);
  });

  it('cây có vòng cha-con không làm treo vòng lặp', () => {
    const broken: TreeNode[] = [n('A', '1', 'B', 'vong lap'), n('B', '2', 'A')];
    expect(() => searchVisible(broken, 'vong')).not.toThrow();
  });
});

describe('ghi nhớ trạng thái mở/đóng (§10.4)', () => {
  function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    };
  }

  it('lưu rồi đọc lại được', () => {
    const store = createExpandedStore(fakeStorage());
    store.save('P-1', new Set(['R', 'P1']));
    expect(store.load('P-1')).toEqual(new Set(['R', 'P1']));
  });

  it('lưu THEO TỪNG dự án, không lẫn sang dự án khác', () => {
    const store = createExpandedStore(fakeStorage());
    store.save('P-1', new Set(['R']));
    expect(store.load('P-2')).toBeNull();
  });

  it('chưa có gì thì trả null để dùng mặc định', () => {
    expect(createExpandedStore(fakeStorage()).load('P-1')).toBeNull();
  });

  it('localStorage ném (chế độ riêng tư) thì KHÔNG làm sập màn hình', () => {
    const hostile = {
      getItem: () => {
        throw new Error('bi chan');
      },
      setItem: () => {
        throw new Error('bi chan');
      },
    } as unknown as Storage;
    const store = createExpandedStore(hostile);
    expect(store.load('P-1')).toBeNull();
    expect(() => store.save('P-1', new Set(['R']))).not.toThrow();
  });

  it('dữ liệu hỏng trong storage thì bỏ qua, không ném', () => {
    const s = fakeStorage();
    s.setItem('planix.expanded.P-1', 'khong-phai-json');
    expect(createExpandedStore(s).load('P-1')).toBeNull();
  });

  it('không có storage (render phía server) thì vẫn chạy', () => {
    const store = createExpandedStore(null);
    expect(store.load('P-1')).toBeNull();
    expect(() => store.save('P-1', new Set())).not.toThrow();
  });
});
