/**
 * Renumber — sinh `wbs_code` và `depth` cho cả cây (SPEC.md §9.4).
 *
 * Hàm thuần: nhận dữ liệu, trả dữ liệu, không đọc DB (CLAUDE.md §3).
 *
 * `uid` ổn định vĩnh viễn, `wbs_code` đổi mỗi lần renumber (§4.3). Mọi tham chiếu
 * giữa các bảng dùng `uid`; `wbs_code` chỉ để người đọc và để hiển thị.
 */

/** Đầu vào tối thiểu để dựng cây. Các trường khác của `task` không ảnh hưởng renumber. */
export interface TaskNode {
  readonly uid: string;
  readonly parentUid: string | null;
  readonly sortOrder: number;
}

export interface RenumberedTask {
  readonly uid: string;
  /** Dạng `1`, `1.1`, `2.3.1`. */
  readonly wbsCode: string;
  /** Gốc là 1. §1.5 thiết kế tới 6 cấp; `N04` cảnh báo khi sâu hơn. */
  readonly depth: number;
}

/**
 * Sắp anh em: `sort_order` tăng dần, hoà thì `uid` tăng dần.
 *
 * Bậc `uid` là chốt chặn — `uid` là khoá chính nên không bao giờ hoà. Thiếu nó thì
 * kết quả phụ thuộc thứ tự mảng đầu vào, tức phụ thuộc thứ tự SQLite trả dòng về,
 * và M2 (cùng input ra cùng output) sụp.
 */
function compareSiblings(a: TaskNode, b: TaskNode): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

export function renumber(tasks: readonly TaskNode[]): RenumberedTask[] {
  if (tasks.length === 0) return [];

  const byUid = new Map<string, TaskNode>();
  for (const t of tasks) {
    if (byUid.has(t.uid)) {
      throw new Error(`Duplicate task uid: ${t.uid}`);
    }
    byUid.set(t.uid, t);
  }

  // Gom con theo cha. Duyệt `tasks` theo thứ tự mảng rồi sắp lại tường minh ở dưới,
  // nên thứ tự chèn vào Map không ảnh hưởng kết quả.
  const childrenOf = new Map<string | null, TaskNode[]>();
  for (const t of tasks) {
    if (t.parentUid !== null) {
      if (t.parentUid === t.uid) {
        // Tiền đề của C08. Bắt ở đây để không rơi vào vòng lặp vô hạn bên dưới.
        throw new Error(`Task is its own parent: ${t.uid}`);
      }
      if (!byUid.has(t.parentUid)) {
        // Tiền đề của C02. Validator báo lỗi tử tế hơn; ở đây chỉ cần không sinh cây sai.
        throw new Error(`Unknown parent_uid ${t.parentUid} on task ${t.uid}`);
      }
    }
    const bucket = childrenOf.get(t.parentUid);
    if (bucket === undefined) {
      childrenOf.set(t.parentUid, [t]);
    } else {
      bucket.push(t);
    }
  }

  for (const bucket of childrenOf.values()) {
    bucket.sort(compareSiblings);
  }

  const out: RenumberedTask[] = [];
  const visited = new Set<string>();

  /**
   * DFS tường minh bằng stack thay vì đệ quy: §1.5 thiết kế tới 6 cấp, nhưng dữ liệu
   * do AI sinh không phải lúc nào cũng tôn trọng điều đó, và tràn stack là kiểu lỗi
   * khó đọc nhất khi nó xảy ra trên dữ liệu thật.
   */
  const stack: Array<{ node: TaskNode; prefix: string; depth: number; index: number }> = [];

  const roots = childrenOf.get(null) ?? [];
  for (let i = roots.length - 1; i >= 0; i--) {
    const node = roots[i];
    if (node === undefined) continue;
    stack.push({ node, prefix: '', depth: 1, index: i + 1 });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;

    const { node, prefix, depth, index } = frame;

    if (visited.has(node.uid)) {
      // Chỉ tới được đây nếu cây có vòng lặp cha-con nhiều bước (tiền đề của C08).
      throw new Error(`Cycle in parent chain at task ${node.uid}`);
    }
    visited.add(node.uid);

    // Chỉ số anh em đã biết lúc đẩy stack. Tìm lại bằng findIndex sẽ cho O(n^2) theo
    // bề rộng cây — với 6.000 task và một cha có hàng nghìn con thì đó là thứ chặn
    // đường ngưỡng import 5 giây (§14.2 P1, CLAUDE.md §5).
    const wbsCode = prefix === '' ? String(index) : `${prefix}.${index}`;

    out.push({ uid: node.uid, wbsCode, depth });

    const children = childrenOf.get(node.uid) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child === undefined) continue;
      stack.push({ node: child, prefix: wbsCode, depth: depth + 1, index: i + 1 });
    }
  }

  if (visited.size !== tasks.length) {
    // Task không với tới được từ gốc nào: cây có vòng lặp không chạm gốc (C08),
    // hoặc nhiều hơn một thành phần liên thông.
    const orphan = tasks.find((t) => !visited.has(t.uid));
    throw new Error(`Task not reachable from any root: ${orphan?.uid ?? 'unknown'}`);
  }

  return out;
}
