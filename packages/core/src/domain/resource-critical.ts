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

/** Chỉ cần đúng một hàm của `CalendarEngine`, nên nhận hẹp lại cho dễ test. */
export interface RcEngine {
  addWorkingDays(calendarId: string, from: DateOnly, days: number): DateOnly;
}

export interface RcInput {
  readonly schedule: ReadonlyMap<string, RcScheduleRow>;
  readonly edges: readonly DepEdge[];
  readonly assignments: readonly RcAssignment[];
  readonly engine: RcEngine;
  /** Lịch B của `default_location` — cùng lịch SGS dùng để cộng lag (§6.1). */
  readonly calendarId: string;
}

/** Một mắt nối ngược: predecessor `uid` ép successor bắt đầu không sớm hơn `bound`. */
interface Link {
  readonly uid: string;
  readonly bound: DateOnly;
}

export function resourceCriticalPath(input: RcInput): ReadonlySet<string> {
  const { schedule, edges, assignments, engine, calendarId } = input;
  const critical = new Set<string>();
  if (schedule.size === 0) return critical;

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
  if (projectEnd === null) return critical;

  // Sắp uid trước khi nạp: `Map` giữ thứ tự chèn, mà thứ tự chèn đến từ thứ tự dòng DB.
  // Kết quả là một Set nên thứ tự duyệt không đổi nội dung — nhưng N2 cấm dựa vào thứ
  // tự duyệt kể cả khi lần này vô hại, vì lần sau sẽ có người thêm một `break` vào đây.
  const queue: string[] = [];
  for (const uid of [...schedule.keys()].sort()) {
    if (schedule.get(uid)?.endDate === projectEnd) {
      critical.add(uid);
      queue.push(uid);
    }
  }

  while (queue.length > 0) {
    const uid = queue.pop();
    if (uid === undefined) break;
    const row = schedule.get(uid);
    if (row === undefined) continue;

    // Mắt ràng buộc là mắt ép ĐÚNG ngày task bắt đầu. Mắt ép sớm hơn nghĩa là task còn
    // dư thời gian so với nó — dời nó một ngày không đẩy được task này.
    //
    // So bằng `===` chứ không `>=`: nới thành `>=` sẽ kéo vào mọi predecessor, và "đường
    // găng" thành "mọi task có quan hệ" — đúng thứ khiến con số này vô dụng.
    for (const link of linksTo.get(uid) ?? []) {
      if (link.bound !== row.startDate) continue;
      // `critical` vừa là kết quả vừa là tập đã thăm, nên vòng trong dữ liệu cũ không
      // làm treo: mỗi uid vào hàng đợi đúng một lần.
      if (critical.has(link.uid)) continue;
      critical.add(link.uid);
      queue.push(link.uid);
    }
  }

  return critical;
}
