/**
 * §7 pha C bước C1 — đường găng SAU khi san tài nguyên.
 *
 * PM chốt phương án (b) ngày 2026-09-13
 * (`docs/decisions/2026-09-13-resource-critical-path-chua-co.md`):
 *
 * > Coi cả liên kết do người là cạnh: nếu B bị đẩy vì chờ người đang làm A, thì A→B là
 * > một cạnh trong đồ thị.
 *
 * Vì sao điều đó là cả điểm của rule này. Pha A đã có `is_critical` trên đồ thị
 * dependency thuần (§7.2: `total_float == 0`). Nếu pha C cũng chỉ đi theo dependency thì
 * nó chỉ lặp lại pha A trên bộ ngày khác — không trả lời được câu PM thật sự hỏi. §7.2
 * nói chênh lệch giữa hai pha là *"chi phí do thiếu người… con số cần khi đàm phán thêm
 * resource"*. Muốn chỉ ra **chuỗi nào** phải thêm người thì chuỗi đó bắt buộc phải chứa
 * các mắt nối bằng người, chứ không chỉ mắt nối bằng ràng buộc.
 *
 * ## Cách xác định
 *
 * Không tính lại float bằng backward pass trên đồ thị trộn. Lý do: ngày cuối cùng đã do
 * SGS quyết, và tính lại float theo công thức CPM trên tập ngày đó sẽ cho ra một con số
 * KHÁC thứ thực sự xảy ra — trên lịch đã san tài nguyên, float lý thuyết không còn nghĩa.
 *
 * Thay vào đó đi NGƯỢC từ ngày kết thúc dự án và hỏi ở mỗi bước: *task này bắt đầu đúng
 * vào ngày mà predecessor nào ép nó?* Predecessor nào ép đúng ngày đó là mắt ràng buộc.
 * Dời nó một ngày là dời cả chuỗi phía sau.
 *
 * Mốc ép của mỗi loại cạnh dùng **đúng công thức SGS đã dùng** để đặt ngày (`sgs.ts`,
 * nhánh tính `candidate`). Chép lại công thức khác đi thì hai bên lệch nhau và rule sẽ
 * im lặng sai — nên chỗ này cố ý trùng từng dòng với bên kia.
 *
 * ## Không dùng `delay_reason`
 *
 * Nhìn thì tưởng `delay_reason` đã trả lời sẵn "cái gì chặn task này". Nhưng SGS chỉ đặt
 * `reason = 'resource'` khi `reason === null`, tức là một task bị dependency đẩy RỒI bị
 * người đẩy tiếp vẫn mang nhãn `'dependency'`. Với §7.6 nhãn đó vẫn đúng ý ("vì sao muộn
 * hơn kế hoạch"), nhưng dùng nó làm đồ thị thì sẽ bỏ sót đúng những mắt do người — thứ
 * phương án (b) sinh ra để bắt. Nên ở đây suy từ NGÀY, không từ nhãn.
 *
 * Hàm thuần (CLAUDE.md §3): nhận dữ liệu, trả tập uid. Không đọc DB, không đọc đồng hồ.
 */

import type { DateOnly } from './date-only.js';
import type { DepEdge } from './dependency.js';

/** Phần lịch cuối cùng mà rule này cần. */
export interface RcScheduleRow {
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
}

/** Phần assignment mà rule này cần — ai làm gì, từ ngày nào tới ngày nào. */
export interface RcAssignment {
  readonly taskUid: string;
  readonly resourceId: string;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
}

/** Chỉ cần vài hàm của `CalendarEngine`, nên nhận hẹp lại cho dễ test. */
export interface RcEngine {
  addWorkingDays(calendarId: string, from: DateOnly, days: number): DateOnly;
  /** Lịch A — năng lực của CHÍNH người đó trong một ngày (0 | 0.5 | 1). */
  capacityOn(resourceId: string, date: DateOnly): number;
}

export interface RcInput {
  readonly schedule: ReadonlyMap<string, RcScheduleRow>;
  readonly edges: readonly DepEdge[];
  readonly assignments: readonly RcAssignment[];
  readonly engine: RcEngine;
  /** Lịch B của `default_location` — cùng lịch SGS dùng để cộng lag (§6.1). */
  readonly calendarId: string;
}

export interface RcResult {
  /** Nghĩa chặt: dời một ngày là đẩy cả chuỗi. */
  readonly critical: ReadonlySet<string>;
  /**
   * Chuỗi bị cắt vì LỆCH LỊCH, không vì có chỗ trống thật. Không giao với `critical`.
   *
   * Xem `docs/decisions/2026-09-13-resource-critical-path-chua-co.md` §5.
   */
  readonly nearCritical: ReadonlySet<string>;
}

/** Một mắt nối ngược: predecessor `uid` ép successor bắt đầu không sớm hơn `bound`. */
interface Link {
  readonly uid: string;
  readonly bound: DateOnly;
}

export function resourceCriticalPath(input: RcInput): RcResult {
  const { schedule, edges, assignments, engine, calendarId } = input;
  if (schedule.size === 0) return { critical: new Set(), nearCritical: new Set() };

  // ── Mốc ép theo cạnh dependency ───────────────────────────────────────────
  //
  // Trùng từng dòng với `sgs.ts`: SS lấy mốc ngày BẮT ĐẦU của predecessor; ba loại còn
  // lại lấy ngày làm việc kế tiếp sau khi predecessor xong.
  const linksTo = new Map<string, Link[]>();
  const addLink = (succUid: string, link: Link): void => {
    const list = linksTo.get(succUid);
    if (list === undefined) linksTo.set(succUid, [link]);
    else list.push(link);
  };

  for (const e of edges) {
    const pred = schedule.get(e.predUid);
    if (pred === undefined) continue;
    if (!schedule.has(e.succUid)) continue;
    addLink(e.succUid, {
      uid: e.predUid,
      bound:
        e.type === 'SS'
          ? engine.addWorkingDays(calendarId, pred.startDate, e.lagDays)
          : engine.addWorkingDays(calendarId, pred.endDate, e.lagDays + 1),
    });
  }

  // ── Mốc ép do người ───────────────────────────────────────────────────────
  //
  // Với mỗi task, người làm nó chỉ rảnh sau khi xong việc trước đó. Mắt chặn là
  // assignment KẾT THÚC MUỘN NHẤT trên cùng người mà vẫn trước ngày task này bắt đầu.
  //
  // Hạn chế đã biết, ghi ra để người sau không tưởng là chính xác tuyệt đối: khi
  // `max_parallel > 1`, một người giữ nhiều task cùng lúc, và nếu vài task cùng kết thúc
  // ngày cuối thì không suy ngược được cái nào thật sự giải phóng đủ chỗ. Chọn tất cả
  // những cái cùng ngày muộn nhất — thà thừa một mắt còn hơn đứt chuỗi, vì đứt chuỗi
  // khiến phần còn lại biến mất khỏi kết quả.
  const byResource = new Map<string, RcAssignment[]>();
  for (const a of assignments) {
    const list = byResource.get(a.resourceId);
    if (list === undefined) byResource.set(a.resourceId, [a]);
    else list.push(a);
  }

  for (const a of assignments) {
    const row = schedule.get(a.taskUid);
    if (row === undefined) continue;

    let latest: DateOnly | null = null;
    for (const other of byResource.get(a.resourceId) ?? []) {
      if (other.taskUid === a.taskUid) continue;
      if (other.toDate >= row.startDate) continue;
      if (latest === null || other.toDate > latest) latest = other.toDate;
    }
    if (latest === null) continue;

    for (const other of byResource.get(a.resourceId) ?? []) {
      if (other.taskUid === a.taskUid) continue;
      if (other.toDate !== latest) continue;
      if (!schedule.has(other.taskUid)) continue;
      addLink(a.taskUid, {
        uid: other.taskUid,
        bound: engine.addWorkingDays(calendarId, other.toDate, 1),
      });
    }
  }

  // ── Đi ngược từ ngày kết thúc dự án ───────────────────────────────────────
  let projectEnd: DateOnly | null = null;
  for (const row of schedule.values()) {
    if (projectEnd === null || row.endDate > projectEnd) projectEnd = row.endDate;
  }
  if (projectEnd === null) return { critical: new Set(), nearCritical: new Set() };
  const end = projectEnd;

  const resourceOfTask = new Map(assignments.map((a) => [a.taskUid, a.resourceId]));

  /**
   * Khoảng `[bound, start)` có ngày làm nào của CHÍNH người làm task này không?
   *
   * Đây là chỗ phân biệt hai loại dư thời gian, và nó là cả nội dung của phương án (iii)
   * PM chốt ngày 2026-09-14:
   *
   *   - Người đó CÓ thể làm trong khoảng đó mà task vẫn chưa bắt đầu ⇒ có chỗ trống
   *     thật. Predecessor dư thời gian thật, không găng kể cả nghĩa lỏng.
   *   - Người đó KHÔNG làm được ngày nào trong khoảng đó ⇒ task đã bắt đầu vào ngày sớm
   *     nhất có thể. "Dư" ở đây chỉ là lệch lịch, không phải chỗ trống.
   *
   * Đo bằng lịch A của đúng người đó nên không cần ngưỡng bằng số ngày: một cụm lễ dài
   * hay ngắn đều xử lý đúng, và một task nghỉ phép dài cũng vậy. Ngưỡng cứng kiểu "3
   * ngày" sẽ vừa bắt hụt Golden Week vừa bắt nhầm chỗ trống thật đúng 3 ngày.
   */
  const gapIsCalendarOnly = (taskUid: string, bound: DateOnly, start: DateOnly): boolean => {
    if (bound >= start) return false;
    const resourceId = resourceOfTask.get(taskUid);
    // Không ai được gán (mốc thuần §7.10) thì không có lịch A để hỏi — không kết luận.
    if (resourceId === undefined) return false;
    for (let day = bound; day < start; day = addOneDay(day)) {
      if (engine.capacityOn(resourceId, day) > 0) return false;
    }
    return true;
  };

  /** Một lượt đi ngược. `near` quyết định mắt nào được coi là ràng buộc. */
  const walk = (near: boolean): Set<string> => {
    const found = new Set<string>();
    // Sắp uid trước khi nạp: `Map` giữ thứ tự chèn, mà thứ tự chèn đến từ thứ tự dòng DB.
    const queue: string[] = [];
    for (const uid of [...schedule.keys()].sort()) {
      if (schedule.get(uid)?.endDate === end) {
        found.add(uid);
        queue.push(uid);
      }
    }

    while (queue.length > 0) {
      const uid = queue.pop();
      if (uid === undefined) break;
      const row = schedule.get(uid);
      if (row === undefined) continue;

      for (const link of linksTo.get(uid) ?? []) {
        // Mắt ràng buộc là mắt ép ĐÚNG ngày task bắt đầu. Mắt ép sớm hơn nghĩa là task
        // còn dư thời gian so với nó — dời nó một ngày không đẩy được task này.
        //
        // So bằng `===` chứ không `>=`: nới thành `>=` sẽ kéo vào mọi predecessor, và
        // "đường găng" thành "mọi task có quan hệ".
        const binding =
          link.bound === row.startDate ||
          (near && gapIsCalendarOnly(uid, link.bound, row.startDate));
        if (!binding) continue;
        // `found` vừa là kết quả vừa là tập đã thăm, nên vòng trong dữ liệu cũ không làm
        // treo: mỗi uid vào hàng đợi đúng một lần.
        if (found.has(link.uid)) continue;
        found.add(link.uid);
        queue.push(link.uid);
      }
    }
    return found;
  };

  const critical = walk(false);
  const nearCritical = walk(true);
  // Hai tập rời nhau: một task đã găng nghĩa chặt thì không cần nhãn lỏng nữa.
  for (const uid of critical) nearCritical.delete(uid);

  return { critical, nearCritical };
}

/** Cộng một ngày LỊCH (không phải ngày làm) — dùng để quét khoảng. */
function addOneDay(date: DateOnly): DateOnly {
  const t = new Date(`${date}T00:00:00Z`).getTime() + 86400000;
  return new Date(t).toISOString().slice(0, 10) as DateOnly;
}
