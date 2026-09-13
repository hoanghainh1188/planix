/**
 * Logic của S4 — SPEC.md §10.5.
 *
 * Tách khỏi component vì đây là phần quyết định màn hình có dùng được không: lọc đúng thì
 * lead nhìn 20 dòng, lọc sai thì nhìn 300. Hàm thuần, có test riêng, không đụng DOM.
 *
 * Không đụng `Date`: mọi mốc thời gian đi vào qua tham số (`statusDate`). Component đọc
 * đồng hồ ở biên nếu cần, giống cách server làm (N2).
 */

import { compareWbs } from './tree-model.js';

export type ProgressStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export interface Suggestion {
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
}

export interface SavedProgress {
  readonly status: string;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
}

export interface BoardRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly parentUid: string | null;
  readonly parentName: string | null;
  readonly effortMd: number | null;
  readonly pic: string | null;
  readonly teamId: string | null;
  readonly isMicro: boolean;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly saved: SavedProgress | null;
  readonly suggestion: Suggestion;
  readonly onTrack: boolean;
}

export interface DraftEntry {
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
  /** Còn là đề xuất máy điền (hiện màu xám) hay đã được lead chốt. */
  readonly isSuggestion: boolean;
}

export type Draft = ReadonlyMap<string, DraftEntry>;

/**
 * §10.5: "engine điền sẵn đề xuất (màu xám, chưa lưu)".
 *
 * Dòng đã có người nhập thì giữ nguyên giá trị đã lưu — đề xuất không được đè lên quyết
 * định của con người.
 */
export function buildDraft(rows: readonly BoardRow[]): Draft {
  const draft = new Map<string, DraftEntry>();
  for (const row of rows) {
    if (row.saved !== null) {
      draft.set(row.uid, {
        status: row.saved.status as ProgressStatus,
        percent: row.saved.percent,
        actualStart: row.saved.actualStart,
        actualEnd: row.saved.actualEnd,
        blockedNote: row.saved.blockedNote,
        isSuggestion: false,
      });
    } else {
      draft.set(row.uid, {
        status: row.suggestion.status,
        percent: row.suggestion.percent,
        actualStart: row.suggestion.actualStart,
        actualEnd: row.suggestion.actualEnd,
        blockedNote: null,
        isSuggestion: true,
      });
    }
  }
  return draft;
}

export interface VisibleRow {
  readonly row: BoardRow;
  readonly entry: DraftEntry;
}

export interface FilterOptions {
  /** Bỏ lọc mặc định, hiện cả task đã done và task chưa tới hạn. */
  readonly showAll?: boolean;
  /** Bung nhóm "on track" ra thành từng dòng. */
  readonly expandOnTrack?: boolean;
  readonly query?: string;
}

/**
 * Lọc mặc định của §10.5: chưa `done`, đã tới ngày bắt đầu, và gom nhóm "on track".
 *
 * Mục tiêu ghi thẳng trong spec: "từ 300 dòng xuống 20–40 dòng thật sự cần nhìn".
 */
export function visibleRows(
  rows: readonly BoardRow[],
  draft: Draft,
  statusDate: string,
  options: FilterOptions,
): VisibleRow[] {
  const query = (options.query ?? '').trim().toLowerCase();
  const out: VisibleRow[] = [];

  for (const row of rows) {
    const entry = draft.get(row.uid);
    if (entry === undefined) continue;

    if (query !== '') {
      const hit =
        row.name.toLowerCase().includes(query) || row.wbsCode.toLowerCase().startsWith(query);
      if (!hit) continue;
    }

    if (options.showAll !== true) {
      // Lọc theo trạng thái ĐÃ LƯU, không theo `entry` — `entry` khởi tạo bằng đề xuất,
      // nên lọc theo nó sẽ giấu đúng những dòng quá hạn mà máy đoán "done" trong khi
      // chưa ai xác nhận. Đó là dòng cần nhìn nhất.
      //
      // Lọc theo giá trị đã lưu còn có lợi thứ hai: dòng lead vừa bấm Done không biến
      // mất ngay dưới con trỏ, mà ở lại cho tới lần tải sau.
      const savedStatus = row.saved?.status ?? 'not_started';
      if (savedStatus === 'done' || savedStatus === 'cancelled') continue;
      // Chưa tới ngày bắt đầu thì chưa có gì để báo cáo.
      if (row.planStart === null || row.planStart > statusDate) continue;
    }

    if (row.onTrack && options.expandOnTrack !== true && options.showAll !== true) continue;

    out.push({ row, entry });
  }
  // SQL `ORDER BY wbs_code` sắp theo chuỗi nên 1.1.1.10 chen lên trước 1.1.1.2. Sắp lại
  // bằng natural sort, đúng thứ tự S1 và Gantt đang hiện — ba màn phải cùng một trật tự.
  return out.sort((a, b) => compareWbs(a.row.wbsCode, b.row.wbsCode));
}

/** Số dòng cần chú ý và số dòng lead đã thật sự xử lý — thanh "Reviewed x / y". */
export function attentionCount(
  rows: readonly BoardRow[],
  draft: Draft,
  statusDate: string,
): { reviewed: number; total: number } {
  let reviewed = 0;
  let total = 0;
  for (const row of rows) {
    const entry = draft.get(row.uid);
    if (entry === undefined) continue;
    if (row.onTrack) continue;
    if (row.planStart === null || row.planStart > statusDate) continue;
    total++;
    if (!entry.isSuggestion) reviewed++;
  }
  return { reviewed, total };
}

export type StatusKey = 'D' | 'P' | 'B';

/**
 * Phím tắt §10.5. `P` và `B` bị vô hiệu trên micro task vì §7.9 cấm hai trạng thái đó.
 *
 * `rows` là tùy chọn: chỉ cần khi muốn biết dòng có phải micro task không. Thiếu nó thì
 * coi như task thường — gọi từ test cho task thường sẽ gọn hơn.
 */
export function applyStatusKey(
  draft: Draft,
  uid: string,
  key: StatusKey,
  statusDate: string,
  rows?: readonly BoardRow[],
): Draft {
  const status: ProgressStatus = key === 'D' ? 'done' : key === 'P' ? 'in_progress' : 'blocked';
  return setStatus(draft, uid, status, statusDate, rows);
}

/**
 * Đổi trạng thái một dòng, kéo theo các trường phụ thuộc.
 *
 * MỘT chỗ duy nhất cho cả phím tắt lẫn nút thao tác nhóm. Trước đây phím `B` xoá
 * `actual_end` còn nút "Blocked" thì giữ nguyên, nên cùng một hành động cho ra hai kết
 * quả khác nhau tuỳ người dùng bấm bằng gì.
 */
export function setStatus(
  draft: Draft,
  uid: string,
  status: ProgressStatus,
  statusDate: string,
  rows?: readonly BoardRow[],
): Draft {
  const entry = draft.get(uid);
  if (entry === undefined) return draft;

  // §7.9 — micro task không có `in_progress` và `blocked`.
  const isMicro = rows?.find((r) => r.uid === uid)?.isMicro === true;
  if (isMicro && (status === 'in_progress' || status === 'blocked')) return draft;

  if (status === 'done') {
    return new Map(draft).set(uid, {
      ...entry,
      status,
      percent: 100,
      // Xong mà thiếu ngày xong thì server chặn (§10.5); điền luôn mốc chuẩn.
      actualStart: entry.actualStart ?? statusDate,
      actualEnd: entry.actualEnd ?? statusDate,
      isSuggestion: false,
    });
  }

  if (status === 'not_started' || status === 'cancelled') {
    return new Map(draft).set(uid, {
      ...entry,
      status,
      percent: 0,
      actualStart: null,
      actualEnd: null,
      isSuggestion: false,
    });
  }

  // `in_progress` và `blocked`: đã bắt đầu, CHƯA xong — §7.11 coi cả hai là việc còn dở,
  // nên không được mang theo `actual_end` sót lại từ lần bấm trước.
  return new Map(draft).set(uid, {
    ...entry,
    status,
    actualStart: entry.actualStart ?? statusDate,
    actualEnd: null,
    isSuggestion: false,
  });
}

/** Sửa một ô bất kỳ. Luôn đánh dấu dòng là đã chốt, không còn là đề xuất. */
export function editEntry(draft: Draft, uid: string, patch: Partial<DraftEntry>): Draft {
  const entry = draft.get(uid);
  if (entry === undefined) return draft;
  return new Map(draft).set(uid, { ...entry, ...patch, isSuggestion: false });
}

/** Ctrl+D — chép giá trị dòng nguồn xuống các dòng đang chọn. */
export function fillDown(draft: Draft, sourceUid: string, targetUids: readonly string[]): Draft {
  const source = draft.get(sourceUid);
  if (source === undefined) return draft;

  const next = new Map(draft);
  for (const uid of targetUids) {
    if (uid === sourceUid || !next.has(uid)) continue;
    next.set(uid, {
      status: source.status,
      percent: source.percent,
      actualStart: source.actualStart,
      actualEnd: source.actualEnd,
      blockedNote: source.blockedNote,
      isSuggestion: false,
    });
  }
  return next;
}

/** "Accept all suggestions" — chốt phần còn lại, KHÔNG đụng thứ lead đã sửa tay. */
export function acceptAllSuggestions(draft: Draft): Draft {
  const next = new Map(draft);
  for (const [uid, entry] of draft) {
    if (entry.isSuggestion) next.set(uid, { ...entry, isSuggestion: false });
  }
  return next;
}

/** "Mark subtree done as of <date>" — §10.5. */
export function markSubtreeDone(
  draft: Draft,
  rows: readonly BoardRow[],
  parentUid: string,
  asOf: string,
): Draft {
  const next = new Map(draft);
  for (const row of rows) {
    if (row.parentUid !== parentUid) continue;
    const entry = next.get(row.uid);
    if (entry === undefined) continue;
    next.set(row.uid, {
      ...entry,
      status: 'done',
      percent: 100,
      actualStart: entry.actualStart ?? asOf,
      actualEnd: asOf,
      isSuggestion: false,
    });
  }
  return next;
}

export interface MicroGroup {
  readonly parentUid: string;
  readonly parentName: string;
  readonly done: number;
  readonly total: number;
  readonly uids: readonly string[];
}

/** §10.5: micro task gom theo cụm cha — "Payment module — 12/18 done". */
export function groupMicroByParent(rows: readonly BoardRow[], draft: Draft): MicroGroup[] {
  const byParent = new Map<string, { name: string; uids: string[]; done: number }>();

  for (const row of rows) {
    if (!row.isMicro) continue;
    const key = row.parentUid ?? '';
    const group = byParent.get(key) ?? { name: row.parentName ?? 'Ungrouped', uids: [], done: 0 };
    group.uids.push(row.uid);
    if (draft.get(row.uid)?.status === 'done') group.done++;
    byParent.set(key, group);
  }

  // Sắp theo uid cụm để thứ tự không phụ thuộc thứ tự duyệt Map (N2).
  return [...byParent.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([parentUid, g]) => ({
      parentUid,
      parentName: g.name,
      done: g.done,
      total: g.uids.length,
      uids: g.uids,
    }));
}

export interface SaveRow {
  readonly taskUid: string;
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
}

/**
 * Chỉ gửi dòng lead đã chốt.
 *
 * Gửi cả đề xuất chưa ai đụng tới sẽ biến "máy đoán" thành "người đã xác nhận" — sau đó
 * không còn phân biệt được nữa, và chỉ số §15.1 "tỷ lệ task phải sửa khác đề xuất" mất
 * nghĩa.
 */
export function changedRows(draft: Draft, rows: readonly BoardRow[]): SaveRow[] {
  const byUid = new Map(rows.map((r) => [r.uid, r]));
  const out: SaveRow[] = [];

  for (const [uid, entry] of draft) {
    if (entry.isSuggestion) continue;

    // Đã lưu rồi và không đổi gì thì KHÔNG gửi lại. Thiếu phép so này thì sau khi lưu
    // nút vẫn báo "Save 4 rows", lead không biết còn gì chưa lưu, và mỗi lần bấm lại
    // ghi đè y nguyên bằng ấy dòng kèm ngần ấy dòng audit_log vô nghĩa.
    const saved = byUid.get(uid)?.saved;
    if (saved !== undefined && saved !== null && sameAsSaved(entry, saved)) continue;

    out.push({
      taskUid: uid,
      status: entry.status,
      percent: entry.percent,
      actualStart: entry.actualStart,
      actualEnd: entry.actualEnd,
      blockedNote: entry.blockedNote,
    });
  }
  // Thứ tự ổn định để test và audit log đọc được.
  return out.sort((a, b) => (a.taskUid < b.taskUid ? -1 : a.taskUid > b.taskUid ? 1 : 0));
}

function sameAsSaved(entry: DraftEntry, saved: SavedProgress): boolean {
  return (
    entry.status === saved.status &&
    entry.percent === saved.percent &&
    entry.actualStart === saved.actualStart &&
    entry.actualEnd === saved.actualEnd &&
    entry.blockedNote === saved.blockedNote
  );
}
