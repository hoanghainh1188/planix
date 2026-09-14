/**
 * `blocking_ref` phải là một task THẬT (§7.6: `dependency` → "uid predecessor").
 *
 * SGS chạy trên đồ thị có nút gộp: một ràng buộc giữa hai summary (§6.2) được mở thành
 * "mọi lá của A → `~join-nnnnn` → mọi lá của B" để khỏi sinh |A|×|B| cạnh. Trong đồ thị đó
 * nút gộp là một nút thật, nên khi nó là thứ đẩy lá của B muộn đi, SGS ghi `blockingRef`
 * bằng uid của nút gộp — đúng với SGS, sai với mọi người đọc bên ngoài.
 *
 * Nút gộp không có dòng `task`, nên ghi nó xuống DB là để lọt một khoá không trỏ tới đâu.
 * Đo trên `data/dev.db`: 228/744 dòng `schedule` mang ref kiểu này. `explainTask` dừng
 * chuỗi ngay tại đó, và S2 sẽ in ra "Waiting for ~join-00013".
 *
 * Hàm này đi xuyên qua nút gộp để tới lá THẬT đã quyết định ngày: lá của A xong muộn nhất
 * — chính là thứ nút gộp đang chờ.
 */

import type { SgsScheduleRow } from './sgs.js';

export interface RefEdge {
  readonly predUid: string;
  readonly succUid: string;
  readonly type: string;
}

/**
 * Trả về bản sao của `rows` với mọi `blockingRef` trỏ vào nút gộp đã được thay bằng task
 * thật. Không đổi `delayReason`, không đổi ngày.
 *
 * @param rows      dòng sẽ ghi xuống DB (đã gỡ nút gộp)
 * @param full      lịch CÓ nút gộp — để đọc `blockingRef` của chính nút gộp
 * @param edges     cạnh SGS đã dùng — để lùi về khi nút gộp không tự ghi ai đẩy nó
 * @param joinUids  tập uid nút gộp
 */
export function resolveBlockingRefs(
  rows: ReadonlyMap<string, SgsScheduleRow>,
  full: ReadonlyMap<string, SgsScheduleRow>,
  edges: readonly RefEdge[],
  joinUids: ReadonlySet<string>,
): Map<string, SgsScheduleRow> {
  // Chỉ gom cạnh ĐI VÀO nút gộp — mỗi nút tra một lần, không quét lại cả danh sách cạnh.
  const intoJoin = new Map<string, RefEdge[]>();
  for (const e of edges) {
    if (!joinUids.has(e.succUid)) continue;
    const list = intoJoin.get(e.succUid);
    if (list === undefined) intoJoin.set(e.succUid, [e]);
    else list.push(e);
  }

  const resolve = (start: string): string | null => {
    const seen = new Set<string>();
    let cursor = start;
    while (joinUids.has(cursor)) {
      // Đồ thị cạnh không có chu trình (`C05`), nhưng một vòng ở đây treo tiến trình chứ
      // không báo lỗi — chặn ngay cả khi "về lý thuyết không xảy ra".
      if (seen.has(cursor)) return null;
      seen.add(cursor);

      const own = full.get(cursor);
      if (own?.delayReason === 'dependency' && own.blockingRef !== null) {
        cursor = own.blockingRef;
        continue;
      }

      // Nút gộp không ghi ai đẩy nó (nó bắt đầu đúng ngày sớm nhất được phép). Lá của B
      // vẫn chờ nó, nên người phải chờ là lá của A xong muộn nhất.
      const next = latestPredecessor(intoJoin.get(cursor) ?? [], full);
      if (next === null) return null;
      cursor = next;
    }
    return cursor;
  };

  const out = new Map<string, SgsScheduleRow>();
  for (const [uid, row] of rows) {
    if (row.blockingRef === null || !joinUids.has(row.blockingRef)) {
      out.set(uid, row);
      continue;
    }
    out.set(uid, { ...row, blockingRef: resolve(row.blockingRef) });
  }
  return out;
}

/**
 * Lá có mốc muộn nhất trong các cạnh vào một nút gộp. `SS` lấy mốc ở ngày bắt đầu, còn lại
 * lấy ngày kết thúc — cùng quy ước với SGS.
 *
 * Tie-break theo uid tăng dần: hai lá xong cùng ngày thì phải chọn ra cùng một lá ở mọi
 * lần chạy (N2).
 */
function latestPredecessor(
  into: readonly RefEdge[],
  full: ReadonlyMap<string, SgsScheduleRow>,
): string | null {
  let best: { uid: string; bound: string } | null = null;
  for (const e of into) {
    const row = full.get(e.predUid);
    if (row === undefined) continue;
    const bound = e.type === 'SS' ? row.startDate : row.endDate;
    if (best === null || bound > best.bound || (bound === best.bound && e.predUid < best.uid)) {
      best = { uid: e.predUid, bound };
    }
  }
  return best?.uid ?? null;
}
