/**
 * Mô hình cây WBS cho màn S1 — SPEC.md §10.4.
 *
 * Tách khỏi React hoàn toàn: đây là phần có logic thật (thu gọn, mở theo cấp, tìm kiếm,
 * ghi nhớ trạng thái), và nó test được mà không cần dựng DOM. Component chỉ vẽ ra thứ
 * hàm ở đây trả về.
 */

export interface TreeNode {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
}

export interface FlatRow<T extends TreeNode> {
  readonly node: T;
  /** Có con hay không — quyết định hiện nút thu gọn. */
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
}

/** §10.4: "Mặc định chỉ mở tới cấp 3." */
export const DEFAULT_EXPAND_DEPTH = 3;

/**
 * Tập uid đang mở khi mở màn lần đầu.
 *
 * Mở tới cấp 3 nghĩa là node ở cấp 1 và 2 được mở (để thấy con của chúng ở cấp 3), còn
 * node cấp 3 thì đóng. Với 6.000 task, mở hết sẽ đổ 6.000 dòng vào lần render đầu.
 */
export function defaultExpanded<T extends TreeNode>(
  nodes: readonly T[],
  maxDepth: number = DEFAULT_EXPAND_DEPTH,
): Set<string> {
  return new Set(nodes.filter((n) => n.depth < maxDepth).map((n) => n.uid));
}

/**
 * Trải cây thành danh sách phẳng để virtualize.
 *
 * Chỉ trả về dòng THẬT SỰ hiện — node nằm dưới một tổ tiên đang đóng thì không có mặt.
 * Danh sách virtual cần độ dài đúng với số dòng nhìn thấy, nếu không thanh cuộn sẽ sai.
 */
export function flattenVisible<T extends TreeNode>(
  nodes: readonly T[],
  expanded: ReadonlySet<string>,
): Array<FlatRow<T>> {
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const list = children.get(n.parentUid);
    if (list === undefined) children.set(n.parentUid, [n]);
    else list.push(n);
  }
  // Sắp theo wbs_code để thứ tự hiển thị khớp thứ tự cây, không phụ thuộc thứ tự mảng vào.
  for (const list of children.values()) list.sort((a, b) => compareWbs(a.wbsCode, b.wbsCode));

  const out: Array<FlatRow<T>> = [];

  function walk(parentUid: string | null): void {
    for (const node of children.get(parentUid) ?? []) {
      const kids = children.get(node.uid) ?? [];
      const isExpanded = expanded.has(node.uid);
      out.push({ node, hasChildren: kids.length > 0, isExpanded });
      if (isExpanded && kids.length > 0) walk(node.uid);
    }
  }
  walk(null);
  return out;
}

/**
 * Natural sort cho `wbs_code` (§11.5).
 *
 * So chuỗi thuần đặt `1.10` trước `1.9`. Cây WBS 6.000 task chắc chắn có cha hơn 9 con.
 */
export function compareWbs(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = Number(as[i]);
    const y = Number(bs[i]);
    if (x !== y) return x - y;
  }
  return as.length - bs.length;
}

export function toggle(expanded: ReadonlySet<string>, uid: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  return next;
}

/** §10.4: "Thu gọn/mở theo cấp." */
export function expandToDepth<T extends TreeNode>(
  nodes: readonly T[],
  maxDepth: number,
): Set<string> {
  return new Set(nodes.filter((n) => n.depth < maxDepth).map((n) => n.uid));
}

export function collapseAll(): Set<string> {
  return new Set();
}

export function expandAll<T extends TreeNode>(nodes: readonly T[]): Set<string> {
  return new Set(nodes.map((n) => n.uid));
}

/**
 * Tìm kiếm — §10.4: "với 6.000 task đây là cách duy nhất để tìm."
 *
 * Trả về danh sách phẳng chỉ gồm node khớp VÀ mọi tổ tiên của chúng, tất cả đều mở. Chỉ
 * trả node khớp thì người dùng mất ngữ cảnh: một dòng "Design user list" không nói lên
 * nó thuộc phase nào.
 */
export function searchVisible<T extends TreeNode>(
  nodes: readonly T[],
  query: string,
): Array<FlatRow<T>> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return [];

  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const keep = new Set<string>();

  for (const node of nodes) {
    if (!node.name.toLowerCase().includes(trimmed) && !node.wbsCode.startsWith(trimmed)) continue;
    keep.add(node.uid);
    let parent = node.parentUid;
    // Chặn trên bằng số node: cây hỏng có vòng cha-con sẽ treo vòng lặp.
    for (let i = 0; parent !== null && i < nodes.length; i++) {
      if (keep.has(parent)) break;
      keep.add(parent);
      parent = byUid.get(parent)?.parentUid ?? null;
    }
  }

  const kept = nodes.filter((n) => keep.has(n.uid));
  return flattenVisible(kept, new Set(kept.map((n) => n.uid)));
}

// ── Ghi nhớ trạng thái giữa các lần vào (§10.4) ─────────────────────────────

export interface ExpandedStore {
  load(projectId: string): Set<string> | null;
  save(projectId: string, expanded: ReadonlySet<string>): void;
}

const STORAGE_PREFIX = 'planix.expanded.';

/**
 * Lưu theo TỪNG DỰ ÁN.
 *
 * Dùng chung một khoá cho mọi dự án sẽ khiến uid của dự án này lọt sang dự án kia — vô
 * hại về dữ liệu nhưng làm cây mở lung tung, và người dùng không hiểu vì sao.
 *
 * Mọi thao tác bọc try/catch: trình duyệt ở chế độ riêng tư ném ngay khi chạm
 * localStorage, và mất trạng thái mở/đóng không đáng để cả màn hình trắng.
 */
export function createExpandedStore(storage: Storage | null): ExpandedStore {
  return {
    load(projectId) {
      if (storage === null) return null;
      try {
        const raw = storage.getItem(STORAGE_PREFIX + projectId);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return new Set(parsed.filter((x): x is string => typeof x === 'string'));
      } catch {
        return null;
      }
    },
    save(projectId, expanded) {
      if (storage === null) return;
      try {
        storage.setItem(STORAGE_PREFIX + projectId, JSON.stringify([...expanded]));
      } catch {
        // Hết dung lượng hoặc bị chặn — bỏ qua, đây chỉ là tiện ích.
      }
    },
  };
}
