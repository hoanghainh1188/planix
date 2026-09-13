/**
 * Dependency Engine — SPEC.md §6.
 *
 * Ba phép biến đổi đồ thị, tất cả đều **tính lúc chạy, không ghi vào bảng
 * `dependency`** (§6.3, §6.5). Bỏ huỷ một task là mọi thứ tự khôi phục.
 *
 * Hàm thuần (CLAUDE.md §3).
 */

import type { DependencyType } from './validation-types.js';

export type TaskKindLite = 'summary' | 'work' | 'milestone';
export type TaskStatusLite = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export interface DepTask {
  readonly uid: string;
  readonly parentUid: string | null;
  readonly sortOrder: number;
  readonly depth: number;
  readonly kind: TaskKindLite;
  /** Chỉ có nghĩa với summary. NULL = parallel (§6.3). */
  readonly childSequencing: 'parallel' | 'sequential' | null;
  readonly status: TaskStatusLite;
}

export interface DepEdge {
  readonly predUid: string;
  readonly succUid: string;
  readonly type: DependencyType;
  readonly lagDays: number;
}

export interface DepIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Anh em sắp theo sort_order rồi uid — bậc uid là chốt chặn, không bao giờ hoà. */
function compareSiblings(a: DepTask, b: DepTask): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

function childrenOf(tasks: readonly DepTask[]): Map<string, DepTask[]> {
  const map = new Map<string, DepTask[]>();
  for (const t of tasks) {
    if (t.parentUid === null) continue;
    const list = map.get(t.parentUid);
    if (list === undefined) map.set(t.parentUid, [t]);
    else list.push(t);
  }
  for (const list of map.values()) list.sort(compareSiblings);
  return map;
}

/**
 * §6.3 cách 1 — cụm `sequential` sinh cạnh FS ảo giữa các con liên tiếp.
 *
 * Cạnh sinh lúc chạy, KHÔNG ghi vào bảng `dependency`: kéo thả đổi thứ tự con thì
 * chuỗi tự cập nhật, không cần sửa dữ liệu.
 *
 * Con đã huỷ bị loại khỏi chuỗi trước khi nối, nên chuỗi liền mạch qua chỗ trống —
 * không cần bắc cầu thêm lần nữa cho trường hợp này.
 */
export function buildVirtualEdges(tasks: readonly DepTask[]): DepEdge[] {
  const children = childrenOf(tasks);
  const out: DepEdge[] = [];

  // Duyệt theo uid đã sắp để thứ tự cạnh sinh ra không phụ thuộc thứ tự mảng vào (N2).
  const summaries = tasks
    .filter((t) => t.kind === 'summary' && t.childSequencing === 'sequential')
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

  for (const summary of summaries) {
    const kids = (children.get(summary.uid) ?? []).filter((c) => c.status !== 'cancelled');
    for (let i = 1; i < kids.length; i++) {
      const pred = kids[i - 1];
      const succ = kids[i];
      if (pred === undefined || succ === undefined) continue;
      out.push({ predUid: pred.uid, succUid: succ.uid, type: 'FS', lagDays: 0 });
    }
  }
  return out;
}

/**
 * §6.5 — bảng bắc cầu khi task giữa chuỗi bị huỷ.
 *
 * Chỉ ghép được khi hai cạnh **cùng nhóm ngữ nghĩa**. Ghép SS với FF qua một nút đã
 * biến mất cho ra ngữ nghĩa mơ hồ, nên thà báo `N07` để PM nối tay còn hơn lặng lẽ
 * sinh ra lịch sai.
 */
function bridgeType(x: DependencyType, y: DependencyType): DependencyType | null {
  if (x === 'FS' && y === 'FS') return 'FS';
  if (x === 'FS' && y === 'SS') return 'FS';
  if (x === 'SS' && y === 'SS') return 'SS';
  if (x === 'FF' && y === 'FF') return 'FF';
  return null;
}

export function bridgeCancelled(
  tasks: readonly DepTask[],
  edges: readonly DepEdge[],
): { edges: DepEdge[]; issues: DepIssue[] } {
  const cancelled = tasks.filter((t) => t.status === 'cancelled').map((t) => t.uid);
  if (cancelled.length === 0) return { edges: [...edges], issues: [] };

  const issues: DepIssue[] = [];
  let current = [...edges];

  // Khử TỪNG NÚT MỘT, không quét toàn bộ cạnh theo vòng.
  //
  // Quét theo vòng làm đứt chuỗi khi hai task huỷ nằm liền nhau: cạnh ghép được ở
  // vòng này lại trỏ vào một nút cũng đã huỷ, nhưng cạnh đi ra của nút đó đã bị vòng
  // trước tiêu thụ mất. Khử từng nút thì A->B->C->D với B và C cùng huỷ cho A->C rồi
  // A->D, đúng yêu cầu bắc cầu đệ quy của §6.5.
  //
  // Duyệt theo uid đã sắp để kết quả không phụ thuộc thứ tự mảng đầu vào (N2).
  for (const dead of [...cancelled].sort()) {
    const incoming = current.filter((e) => e.succUid === dead && e.predUid !== dead);
    const outgoing = current.filter((e) => e.predUid === dead && e.succUid !== dead);
    const rest = current.filter((e) => e.predUid !== dead && e.succUid !== dead);

    const bridged: DepEdge[] = [];
    for (const before of incoming) {
      for (const after of outgoing) {
        const type = bridgeType(before.type, after.type);
        if (type === null) {
          issues.push({
            code: 'N07',
            severity: 'Minor',
            message: `Cannot bridge ${before.type} + ${after.type} through cancelled task ${dead}; link dropped, reconnect manually.`,
            detail: {
              cancelledUid: dead,
              predUid: before.predUid,
              succUid: after.succUid,
              predType: before.type,
              succType: after.type,
            },
          });
          continue;
        }
        bridged.push({
          predUid: before.predUid,
          succUid: after.succUid,
          type,
          lagDays: before.lagDays + after.lagDays,
        });
      }
    }

    // Cạnh chạm `dead` mà không ghép được (đầu hoặc cuối chuỗi) biến mất cùng nút.
    current = [...rest, ...bridged];
  }

  return { edges: current, issues };
}

/** Lá của một nhánh: task không có con, và chưa bị huỷ. */
function leavesUnder(
  rootUid: string,
  children: ReadonlyMap<string, DepTask[]>,
  byUid: ReadonlyMap<string, DepTask>,
): string[] {
  const out: string[] = [];
  const stack = [rootUid];
  while (stack.length > 0) {
    const uid = stack.pop();
    if (uid === undefined) continue;
    const kids = children.get(uid) ?? [];
    if (kids.length === 0) {
      const task = byUid.get(uid);
      // Summary không có con KHÔNG phải lá: dưới nó không có việc nào, nên ràng buộc
      // đi qua nó là rỗng. Coi nó là lá sẽ sinh ra cạnh trỏ vào một task không bao giờ
      // được lập lịch.
      if (task !== undefined && task.kind !== 'summary' && task.status !== 'cancelled') {
        out.push(uid);
      }
      continue;
    }
    for (const k of kids) stack.push(k.uid);
  }
  return out.sort();
}

/**
 * §6.2 — mở rộng ràng buộc khai ở summary xuống lá.
 *
 * Với `A --(FS)--> B`, cả hai là summary:
 *   với mọi lá b thuộc B: b.earliest_start >= max(lá a thuộc A: a.finish) + lag
 *
 * Cài đặt bằng tích Descartes lá(A) × lá(B). Với cụm lớn số cạnh nở nhanh, nhưng
 * scheduler §6.2 xếp lịch **theo cụm** nên đồ thị thật mà nó duyệt vẫn là đồ thị
 * summary; tích này chỉ dùng khi cần ràng buộc ở mức lá.
 */
export function expandSummaryEdges(
  tasks: readonly DepTask[],
  edges: readonly DepEdge[],
): DepEdge[] {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const children = childrenOf(tasks);
  const leafCache = new Map<string, string[]>();

  function leaves(uid: string): string[] {
    const hit = leafCache.get(uid);
    if (hit !== undefined) return hit;
    const value = leavesUnder(uid, children, byUid);
    leafCache.set(uid, value);
    return value;
  }

  const out: DepEdge[] = [];
  for (const edge of edges) {
    for (const predLeaf of leaves(edge.predUid)) {
      for (const succLeaf of leaves(edge.succUid)) {
        out.push({
          predUid: predLeaf,
          succUid: succLeaf,
          type: edge.type,
          lagDays: edge.lagDays,
        });
      }
    }
  }

  // Sắp ổn định: kết quả không được phụ thuộc thứ tự mảng đầu vào (N2).
  return out.sort((a, b) => {
    if (a.predUid !== b.predUid) return a.predUid < b.predUid ? -1 : 1;
    if (a.succUid !== b.succUid) return a.succUid < b.succUid ? -1 : 1;
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });
}

// ── §6.2 / §7.3 bước 1 — chia cụm và topo sort ──────────────────────────────

export interface Cluster {
  readonly uid: string;
  readonly leafUids: readonly string[];
}

/**
 * Chia cây thành các **cụm** rồi sắp theo topo (§7.3 bước 1).
 *
 * Cụm là summary SÂU NHẤT còn nằm trong `dependency_max_level` — nghĩa là summary có
 * `depth <= maxLevel` mà không có con nào cũng là summary trong giới hạn đó. Lấy mọi
 * summary `depth <= maxLevel` sẽ khiến cha và con cùng làm cụm và lá bị xếp hai lần.
 *
 * Cạnh khai ở summary bất kỳ được **nâng lên** cụm chứa nó, nên "module thanh toán bắt
 * đầu sau module người dùng" vẫn ràng buộc đúng dù khai ở cấp nào.
 */
export function buildClusters(
  tasks: readonly DepTask[],
  edges: readonly DepEdge[],
  maxLevel: number,
): Cluster[] {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const children = childrenOf(tasks);

  const isClusterRoot = (t: DepTask): boolean => {
    if (t.kind !== 'summary' || t.depth > maxLevel) return false;
    return !(children.get(t.uid) ?? []).some((c) => c.kind === 'summary' && c.depth <= maxLevel);
  };

  const roots = tasks.filter(isClusterRoot).sort((a, b) => (a.uid < b.uid ? -1 : 1));

  // Cây không có summary nào trong giới hạn: coi toàn bộ lá là MỘT cụm, để scheduler
  // vẫn chạy được thay vì trả về rỗng.
  if (roots.length === 0) {
    const leaves = tasks
      .filter((t) => t.kind !== 'summary' && t.status !== 'cancelled')
      .map((t) => t.uid)
      .sort();
    return leaves.length === 0 ? [] : [{ uid: '<all>', leafUids: leaves }];
  }

  const clusterOf = new Map<string, string>();
  const clusters: Cluster[] = roots.map((root) => {
    const leafUids = leavesUnder(root.uid, children, byUid);
    clusterOf.set(root.uid, root.uid);
    // Mọi hậu duệ đều thuộc cụm này, kể cả summary con sâu hơn maxLevel.
    const stack = [root.uid];
    while (stack.length > 0) {
      const uid = stack.pop();
      if (uid === undefined) continue;
      clusterOf.set(uid, root.uid);
      for (const c of children.get(uid) ?? []) stack.push(c.uid);
    }
    return { uid: root.uid, leafUids };
  });

  /**
   * Các cụm mà một task ĐẠI DIỆN cho.
   *
   * Task nằm trong một cụm thì đại diện cho đúng cụm đó. Nhưng cạnh có thể khai ở
   * summary TỔ TIÊN của cụm — ví dụ khai ở cấp phase trong khi cụm là cấp module. Khi
   * đó nó đại diện cho MỌI cụm nằm dưới nó. Bỏ sót nhánh này thì cạnh khai ở cấp trên
   * bị lờ đi và thứ tự cụm sai mà không báo gì.
   */
  function clustersRepresentedBy(uid: string): string[] {
    const direct = clusterOf.get(uid);
    if (direct !== undefined) return [direct];

    const found: string[] = [];
    const stack = [uid];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      const hit = clusterOf.get(current);
      if (hit !== undefined) {
        if (!found.includes(hit)) found.push(hit);
        continue; // không cần đi sâu hơn: cả cây con thuộc cụm đó
      }
      for (const c of children.get(current) ?? []) stack.push(c.uid);
    }
    return found.sort();
  }

  // Nâng cạnh lên mức cụm; bỏ cạnh nội bộ trong cùng một cụm.
  const successors = new Map<string, Set<string>>();
  const indegree = new Map<string, number>(clusters.map((c) => [c.uid, 0]));
  for (const e of edges) {
    for (const a of clustersRepresentedBy(e.predUid)) {
      for (const b of clustersRepresentedBy(e.succUid)) {
        if (a === b) continue;
        const set = successors.get(a) ?? new Set<string>();
        if (!set.has(b)) {
          set.add(b);
          indegree.set(b, (indegree.get(b) ?? 0) + 1);
        }
        successors.set(a, set);
      }
    }
  }

  // Duyệt theo uid đã sắp để thứ tự cụm tái lập được (N2).
  const ready = clusters
    .filter((c) => (indegree.get(c.uid) ?? 0) === 0)
    .map((c) => c.uid)
    .sort();
  const byId = new Map(clusters.map((c) => [c.uid, c]));
  const out: Cluster[] = [];

  while (ready.length > 0) {
    const uid = ready.shift();
    if (uid === undefined) break;
    const cluster = byId.get(uid);
    if (cluster !== undefined) out.push(cluster);
    for (const next of [...(successors.get(uid) ?? [])].sort()) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) {
        const at = ready.findIndex((x) => x > next);
        if (at === -1) ready.push(next);
        else ready.splice(at, 0, next);
      }
    }
  }

  if (out.length !== clusters.length) {
    throw new Error('Cycle in cluster dependency graph (see C01).');
  }
  return out;
}

/** Nút gộp sinh thêm khi mở rộng cạnh summary. Không phải task thật, duration 0. */
export interface SyntheticNode {
  readonly uid: string;
}

export interface CompactExpansion {
  readonly edges: readonly DepEdge[];
  readonly syntheticNodes: readonly SyntheticNode[];
}

/**
 * Mở rộng cạnh summary sang lá theo cách KHÔNG nở tích Descartes.
 *
 * §6.2 viết ràng buộc là:
 *
 *     với mọi lá b thuộc B: b.earliest_start >= max(lá a thuộc A: a.finish) + lag
 *
 * Vế phải là MỘT điểm gộp, không phải quan hệ từng-cặp. `expandSummaryEdges` sinh
 * |A| × |B| cạnh và cho cùng kết quả, nhưng với cụm 100 lá mỗi bên thì một cạnh thành
 * 10.000 cạnh — và §6.2 đặt ra cơ chế cụm chính là để đồ thị NHỎ đi, không phải to ra.
 *
 * Ở đây chèn một nút gộp duration 0 giữa hai bên: |A| + |B| cạnh thay vì |A| × |B|.
 * Ngữ nghĩa giữ nguyên vì nút gộp chỉ bắt đầu khi mọi lá của A xong, và mọi lá của B
 * chỉ bắt đầu sau nó.
 *
 * Cạnh giữa hai lá thì giữ nguyên, không chèn gì.
 */
export function expandSummaryEdgesCompact(
  tasks: readonly DepTask[],
  edges: readonly DepEdge[],
): CompactExpansion {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const children = childrenOf(tasks);
  const leafCache = new Map<string, string[]>();

  function leaves(uid: string): string[] {
    const hit = leafCache.get(uid);
    if (hit !== undefined) return hit;
    const value = leavesUnder(uid, children, byUid);
    leafCache.set(uid, value);
    return value;
  }

  const out: DepEdge[] = [];
  const synthetic: SyntheticNode[] = [];
  let counter = 0;

  // Duyệt theo khoá đã sắp để tên nút gộp tái lập được (N2).
  const ordered = [...edges].sort((a, b) => {
    if (a.predUid !== b.predUid) return a.predUid < b.predUid ? -1 : 1;
    if (a.succUid !== b.succUid) return a.succUid < b.succUid ? -1 : 1;
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });

  for (const edge of ordered) {
    const predLeaves = leaves(edge.predUid);
    const succLeaves = leaves(edge.succUid);
    if (predLeaves.length === 0 || succLeaves.length === 0) continue;

    // Cặp lá–lá, hoặc bên nào chỉ có một lá: nối thẳng, chèn nút gộp chỉ tốn thêm.
    if (predLeaves.length === 1 || succLeaves.length === 1) {
      for (const p of predLeaves) {
        for (const s of succLeaves) {
          out.push({ predUid: p, succUid: s, type: edge.type, lagDays: edge.lagDays });
        }
      }
      continue;
    }

    counter++;
    const joinUid = `~join-${String(counter).padStart(5, '0')}`;
    synthetic.push({ uid: joinUid });

    // Lá của A xong → nút gộp. Lag dồn hết vào vế sau để không cộng nhiều lần.
    for (const p of predLeaves) {
      out.push({ predUid: p, succUid: joinUid, type: edge.type, lagDays: 0 });
    }
    // Nút gộp → lá của B, mang lag của cạnh gốc.
    for (const s of succLeaves) {
      out.push({ predUid: joinUid, succUid: s, type: 'FS', lagDays: edge.lagDays });
    }
  }

  return { edges: out, syntheticNodes: synthetic };
}
