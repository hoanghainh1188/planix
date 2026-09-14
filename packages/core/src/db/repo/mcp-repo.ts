/**
 * Truy vấn riêng cho lớp MCP — SPEC.md §12.1.
 *
 * Vì sao tách khỏi `read-repo.ts`: các màn S1–S7 hỏi "cho tôi dòng để vẽ bảng", còn MCP
 * hỏi "cho tôi sự thật để suy luận". Hai câu hỏi khác nhau nên hình dạng dữ liệu cũng
 * khác: `WbsRow` gộp sẵn `pic`, `issueCodes`, `linkCount` cho lưới, còn tool đọc cần
 * `phase`/`module`/`constraint_type` mà lưới không bao giờ hiện.
 *
 * §12.4: *"Tool đọc KHÔNG trả về text đã diễn giải. Chỉ JSON có cấu trúc."* Nên ở đây
 * không có hàm nào ghép câu — chỉ có dữ liệu.
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3), prepared statement, không nối chuỗi.
 */

import type { Db } from '../migrate.js';
import { loadWbsTree, projectOfTask } from './read-repo.js';

/** Một task như MCP nhìn thấy: dữ liệu thật, không phải dòng để vẽ. */
export interface McpTaskRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly category: string | null;
  readonly phase: string | null;
  readonly module: string | null;
  readonly childSequencing: string | null;
  readonly priority: number;
  readonly constraintType: string | null;
  readonly constraintDate: string | null;
  readonly status: string;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly allocation: number | null;
  readonly isPinned: boolean;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly totalFloat: number | null;
  readonly isCritical: boolean;
  readonly isResourceCritical: boolean;
}

/**
 * Một câu truy vấn cho cả cây.
 *
 * `assignment` là 1-1 với task (§7.8 quyết định 6: đúng một người mỗi task), nên JOIN
 * thẳng không nhân dòng. Không lặp truy vấn theo từng task — CLAUDE.md §8 cấm N+1, và
 * cây 6.000 task thì N+1 ở đây là 6.000 lượt.
 */
export function loadMcpTasks(db: Db, projectId: string): McpTaskRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md,
              t.role, t.category, t.phase, t.module, t.child_sequencing, t.priority,
              t.constraint_type, t.constraint_date,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0)            AS percent,
              p.actual_start, p.actual_end,
              a.resource_id, a.allocation, a.is_pinned,
              r.name AS resource_name,
              s.start_date, s.end_date, s.total_float, s.is_critical, s.is_resource_critical
         FROM task t
         LEFT JOIN progress   p ON p.task_uid = t.uid
         LEFT JOIN assignment a ON a.task_uid = t.uid
         LEFT JOIN resource   r ON r.id = a.resource_id
         LEFT JOIN schedule   s ON s.task_uid = t.uid
        WHERE t.project_id = ?
        ORDER BY t.wbs_code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map(toMcpTask);
}

/**
 * Một task ĐẦY ĐỦ — §12.1 gọi output của `wbs_get_task` đúng bằng chữ đó.
 *
 * Thêm `description` và `externalRef` so với dòng dùng cho danh sách. Cố ý chỉ thêm ở
 * đây: `description` là văn bản dài, nhân với 500 dòng của `wbs_list_tasks` thì phần lớn
 * payload là thứ không ai đọc trong một danh sách.
 */
export interface McpTaskDetailRow extends McpTaskRow {
  readonly description: string | null;
  readonly externalRef: string | null;
}

/** Một task, tra thẳng bằng uid — `wbs_get_task` không cần tải cả cây. */
export function loadMcpTask(db: Db, uid: string): McpTaskDetailRow | undefined {
  const row = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md,
              t.role, t.category, t.phase, t.module, t.child_sequencing, t.priority,
              t.constraint_type, t.constraint_date, t.description, t.external_ref,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0)            AS percent,
              p.actual_start, p.actual_end,
              a.resource_id, a.allocation, a.is_pinned,
              r.name AS resource_name,
              s.start_date, s.end_date, s.total_float, s.is_critical, s.is_resource_critical
         FROM task t
         LEFT JOIN progress   p ON p.task_uid = t.uid
         LEFT JOIN assignment a ON a.task_uid = t.uid
         LEFT JOIN resource   r ON r.id = a.resource_id
         LEFT JOIN schedule   s ON s.task_uid = t.uid
        WHERE t.uid = ?`,
    )
    .get(uid) as Record<string, unknown> | undefined;

  if (row === undefined) return undefined;
  const base: McpTaskDetailRow = {
    ...toMcpTask(row),
    description: (row['description'] as string | null) ?? null,
    externalRef: (row['external_ref'] as string | null) ?? null,
  };
  if (base.kind !== 'summary') return base;

  // Summary KHÔNG có dòng `schedule` — engine chỉ xếp lá, còn ngày và MD của summary là
  // ROLLUP tính từ con (§7.7, `domain/rollup.ts`). Câu truy vấn một dòng ở trên vì thế
  // trả `null` cho mọi trường lịch, trong khi cây S1 hiện ngày thật.
  //
  // Đã thấy tận mắt: panel S2 hiện "—" cho 1.1.1 trong khi dòng cây ngay bên trái hiện
  // 2026-01-05 → 2026-02-12. Cùng một task, hai câu trả lời.
  //
  // Lấy đúng giá trị `loadWbsTree` đã tính chứ không viết một phép rollup thứ hai: hai
  // định nghĩa cho cùng một con số sẽ trôi khỏi nhau, và khi đó không ai biết cái nào
  // đúng. Giá phải trả là một lượt tải cây — chỉ trả khi task là summary, và đo được 34 ms
  // trên 6.000 task.
  const projectId = projectOfTask(db, uid);
  if (projectId === undefined) return base;
  const rolled = loadWbsTree(db, projectId).find((r) => r.uid === uid);
  if (rolled === undefined) return base;

  return {
    ...base,
    effortMd: rolled.effortMd,
    status: rolled.status,
    percent: rolled.percent,
    startDate: rolled.planStart,
    endDate: rolled.planEnd,
  };
}

function toMcpTask(r: Record<string, unknown>): McpTaskRow {
  return {
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    depth: r['depth'] as number,
    parentUid: (r['parent_uid'] as string | null) ?? null,
    name: r['name'] as string,
    kind: r['kind'] as string,
    effortMd: (r['effort_md'] as number | null) ?? null,
    role: (r['role'] as string | null) ?? null,
    category: (r['category'] as string | null) ?? null,
    phase: (r['phase'] as string | null) ?? null,
    module: (r['module'] as string | null) ?? null,
    childSequencing: (r['child_sequencing'] as string | null) ?? null,
    priority: r['priority'] as number,
    constraintType: (r['constraint_type'] as string | null) ?? null,
    constraintDate: (r['constraint_date'] as string | null) ?? null,
    status: r['status'] as string,
    percent: r['percent'] as number,
    actualStart: (r['actual_start'] as string | null) ?? null,
    actualEnd: (r['actual_end'] as string | null) ?? null,
    assigneeId: (r['resource_id'] as string | null) ?? null,
    assigneeName: (r['resource_name'] as string | null) ?? null,
    allocation: (r['allocation'] as number | null) ?? null,
    isPinned: (r['is_pinned'] as number | null) === 1,
    startDate: (r['start_date'] as string | null) ?? null,
    endDate: (r['end_date'] as string | null) ?? null,
    totalFloat: (r['total_float'] as number | null) ?? null,
    isCritical: (r['is_critical'] as number | null) === 1,
    isResourceCritical: (r['is_resource_critical'] as number | null) === 1,
  };
}

export interface CriticalPathRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly totalFloat: number | null;
  /**
   * Chỉ có ở mode `resource`.
   *
   * `true` = găng nghĩa chặt: dời một ngày là đẩy cả chuỗi.
   * `false` = chỉ rời khỏi chuỗi vì LỆCH LỊCH (lễ Nhật, người làm ở JP còn dự án chạy
   * lịch VN), không vì có chỗ trống thật. PM chốt báo cả hai — xem
   * `docs/decisions/2026-09-13-resource-critical-path-chua-co.md` §5.
   */
  readonly strict?: boolean;
}

/**
 * Đường găng — `wbs_get_critical_path`.
 *
 * Hai chế độ đọc hai cột khác nhau, và khác biệt giữa chúng chính là điều §7.2 muốn nói:
 * `cpm` là đường găng lý thuyết của pha A (chưa tính người), `resource` là đường găng
 * THẬT sau khi san tài nguyên ở pha B. Task nằm trên đường thứ hai mà không nằm trên
 * đường thứ nhất là task bị người, không bị ràng buộc.
 *
 * Cột là hằng trong mã nguồn, không ghép từ tham số — `mode` là union hai giá trị nên
 * không có đường nào để chuỗi từ ngoài chạm vào câu SQL.
 */
export function loadCriticalPath(
  db: Db,
  projectId: string,
  mode: 'cpm' | 'resource',
): CriticalPathRow[] {
  // Cột là hằng trong mã nguồn, không ghép từ tham số — `mode` là union hai giá trị nên
  // không có đường nào để chuỗi từ ngoài chạm vào câu SQL.
  //
  // Tie-break bằng `wbs_code` sau `start_date`: nhiều task cùng ngày bắt đầu là chuyện
  // thường, và thứ tự trả về phải xác định (N2).
  if (mode === 'cpm') {
    const rows = db
      .prepare(
        `SELECT t.uid, t.wbs_code, t.name, s.start_date, s.end_date, s.total_float
           FROM task t JOIN schedule s ON s.task_uid = t.uid
          WHERE t.project_id = ? AND s.is_critical = 1
          ORDER BY s.start_date, t.wbs_code`,
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(toPathRow);
  }

  // Mode `resource` trả CẢ HAI mức, mỗi dòng tự nói mình thuộc mức nào. Lọc sẵn chỉ mức
  // chặt sẽ giấu mất phần chuỗi bị lễ Nhật cắt — đúng thứ phương án (iii) sinh ra để
  // khỏi mất.
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, s.start_date, s.end_date, s.total_float,
              s.is_resource_critical
         FROM task t JOIN schedule s ON s.task_uid = t.uid
        WHERE t.project_id = ?
          AND (s.is_resource_critical = 1 OR s.is_resource_near_critical = 1)
        ORDER BY s.start_date, t.wbs_code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...toPathRow(r),
    strict: (r['is_resource_critical'] as number) === 1,
  }));
}

function toPathRow(r: Record<string, unknown>): CriticalPathRow {
  return {
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    startDate: (r['start_date'] as string | null) ?? null,
    endDate: (r['end_date'] as string | null) ?? null,
    totalFloat: (r['total_float'] as number | null) ?? null,
  };
}

/** Một mắt trong chuỗi chặn. `ref` là task uid, resource id hay project id tuỳ `reason`. */
export interface BlockingLink {
  readonly taskUid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  /** `'dependency' | 'resource' | 'cross_project' | 'calendar' | 'constraint'`, hoặc null. */
  readonly reason: string | null;
  readonly ref: string | null;
  /**
   * `ref` viết cho người đọc: tên người, mã dự án, hay mã WBS của task đứng trước.
   *
   * `ref` là khoá — `R-03`, `P-UTG`, `T-0412` — đúng cho máy nhưng vô nghĩa với PM. §7.6
   * gọi `delay_reason` là thứ "trả lời được câu hỏi của khách", và "chờ R-03" không trả lời
   * được gì. `null` khi `ref` trống hoặc trỏ tới thứ đã bị xoá.
   */
  readonly refLabel: string | null;
}

export interface TaskExplanation {
  readonly taskUid: string;
  /** Rỗng khi dự án chưa xếp lịch lần nào. */
  readonly chain: readonly BlockingLink[];
  /**
   * `true` khi chuỗi bị cắt vì chạm trần, không phải vì đã tới gốc.
   *
   * Nói ra thay vì im lặng: một chuỗi cụt trông y hệt một chuỗi đã hết, và AI đọc nhầm
   * cái thứ hai thành "không còn gì chặn nữa" thì kết luận sai.
   */
  readonly truncated: boolean;
}

/**
 * Dịch `blocking_ref` sang thứ người đọc được, theo đúng bảng §7.6: `resource` trỏ tới một
 * người, `cross_project` tới một dự án, `dependency` tới một task. `calendar` và
 * `constraint` không có ref.
 *
 * Chuẩn bị câu lệnh một lần cho cả chuỗi — chuỗi dài tới `MAX_CHAIN` mắt, và mỗi mắt tra
 * một lần là đủ, không có N+1 theo số task của dự án.
 */
function refLabeller(db: Db): (reason: string | null, ref: string | null) => string | null {
  const person = db.prepare('SELECT name FROM resource WHERE id = ?');
  const project = db.prepare('SELECT code FROM project WHERE id = ?');
  const task = db.prepare('SELECT wbs_code FROM task WHERE uid = ?');

  return (reason, ref) => {
    if (ref === null) return null;
    const pick = (row: unknown, key: string): string | null => {
      if (typeof row !== 'object' || row === null) return null;
      const value = (row as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : null;
    };
    if (reason === 'resource') return pick(person.get(ref), 'name');
    if (reason === 'cross_project') return pick(project.get(ref), 'code');
    if (reason === 'dependency') return pick(task.get(ref), 'wbs_code');
    return null;
  };
}

/** Trần độ dài chuỗi. Sâu hơn thế thì bản thân độ sâu mới là vấn đề, không phải mắt cuối. */
const MAX_CHAIN = 20;

/**
 * `wbs_explain_task` — `delay_reason` cộng chuỗi chặn (§12.1).
 *
 * Chỉ đi tiếp khi `reason === 'dependency'`: lúc đó `blocking_ref` là uid của task đứng
 * trước (§7.6). Với `resource` thì ref là một người, với `cross_project` là một dự án —
 * đi tiếp ở đó là đi sai bảng, nên chuỗi dừng và AI tự đọc `ref` để hỏi tiếp.
 *
 * `seen` chặn vòng lặp. Cấu trúc dependency không được có chu trình (`C05`), nhưng lịch
 * là dữ liệu đã lưu và có thể cũ hơn cấu trúc hiện tại — một vòng ở đây sẽ treo tiến
 * trình chứ không báo lỗi, nên phải chặn ngay cả khi "về lý thuyết không xảy ra".
 */
export function explainTask(db: Db, uid: string): TaskExplanation {
  const stmt = db.prepare(
    `SELECT t.uid, t.wbs_code, t.name, s.start_date, s.end_date, s.delay_reason, s.blocking_ref
       FROM task t LEFT JOIN schedule s ON s.task_uid = t.uid
      WHERE t.uid = ?`,
  );

  const labelOf = refLabeller(db);
  const chain: BlockingLink[] = [];
  const seen = new Set<string>();
  let cursor: string | null = uid;
  let truncated = false;

  while (cursor !== null) {
    if (seen.has(cursor)) break;
    if (chain.length >= MAX_CHAIN) {
      truncated = true;
      break;
    }
    seen.add(cursor);

    const row = stmt.get(cursor) as Record<string, unknown> | undefined;
    if (row === undefined) break;

    const reason = (row['delay_reason'] as string | null) ?? null;
    const ref = (row['blocking_ref'] as string | null) ?? null;
    chain.push({
      taskUid: row['uid'] as string,
      wbsCode: row['wbs_code'] as string,
      name: row['name'] as string,
      startDate: (row['start_date'] as string | null) ?? null,
      endDate: (row['end_date'] as string | null) ?? null,
      reason,
      ref,
      refLabel: labelOf(reason, ref),
    });

    cursor = reason === 'dependency' ? ref : null;
  }

  return { taskUid: uid, chain, truncated };
}

/** Một lượt đặt chỗ, dùng cho ma trận người × kỳ (§12.1 `wbs_get_resource_load`). */
export interface LoadSpanRow {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly allocation: number;
  /** Khối lượng thật của task — thứ dùng để rải tải, xem `spreadOf` trong domain. */
  readonly effortMd: number;
  readonly projectId: string;
}

/**
 * Đặt chỗ giao với cửa sổ `[from, to]`.
 *
 * `crossProject` quyết định phạm vi, và khác biệt giữa hai chế độ là có thật: §7.12 cho
 * hai dự án dùng chung một pool nhân sự, nên chỉ nhìn dự án đang xét sẽ thấy một người
 * bận kín ở nơi khác là "đang rảnh". Đó là câu trả lời sai cho câu hỏi hay được hỏi nhất.
 *
 * Lọc giao khoảng ngay trong SQL chứ không tải hết rồi lọc trong JS: pool nhân sự dùng
 * chung nên bảng `assignment` là toàn cục, không giới hạn theo dự án.
 */
export function loadSpansInWindow(
  db: Db,
  params: {
    readonly projectId: string;
    readonly from: string;
    readonly to: string;
    readonly crossProject: boolean;
  },
): LoadSpanRow[] {
  const sql = `SELECT a.resource_id, r.name, a.from_date, a.to_date, a.allocation,
                      COALESCE(t.effort_md, 0) AS effort_md, t.project_id
                 FROM assignment a
                 JOIN task t     ON t.uid = a.task_uid
                 JOIN resource r ON r.id = a.resource_id
                WHERE a.from_date <= ? AND a.to_date >= ?
                  ${params.crossProject ? '' : 'AND t.project_id = ?'}
                ORDER BY a.resource_id, a.from_date, a.task_uid`;

  const args: unknown[] = params.crossProject
    ? [params.to, params.from]
    : [params.to, params.from, params.projectId];

  const rows = db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    resourceName: r['name'] as string,
    fromDate: r['from_date'] as string,
    toDate: r['to_date'] as string,
    allocation: r['allocation'] as number,
    effortMd: r['effort_md'] as number,
    projectId: r['project_id'] as string,
  }));
}

/**
 * Người cần báo cáo: ai có đặt chỗ trong dự án này, HOẶC ai đảm nhiệm được role mà dự án
 * đang dùng.
 *
 * Vế thứ hai là chỗ quan trọng: người chưa được xếp việc nào thì không có dòng
 * `assignment` nào, và họ chính là người PM đang đi tìm khi hỏi "ai đang rảnh".
 */
export function loadRelevantResources(
  db: Db,
  projectId: string,
): Array<{ id: string; name: string }> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.id, r.name
         FROM resource r
        WHERE r.id IN (SELECT a.resource_id FROM assignment a
                         JOIN task t ON t.uid = a.task_uid
                        WHERE t.project_id = ?)
           OR r.id IN (SELECT rr.resource_id FROM resource_role rr
                        WHERE rr.role IN (SELECT DISTINCT role FROM task
                                           WHERE project_id = ? AND role IS NOT NULL))
        ORDER BY r.id`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: r['id'] as string, name: r['name'] as string }));
}

/**
 * Mọi lượt đặt chỗ giao với cửa sổ, kèm dự án giữ nó — S9 (§10.3, §7.12).
 *
 * Không lọc theo dự án nào: `resource` là tài nguyên toàn cục (§7.12) và cả điểm của màn
 * này là nhìn thấy phần mà một dự án đơn lẻ KHÔNG nhìn thấy.
 *
 * Chỉ lấy dự án `planning` / `active` — cùng tập §7.12 dùng khi xếp lịch. Dự án đã đóng
 * vẫn còn `assignment` trong DB, và đếm chúng vào sẽ khiến người ta trông như bị đặt kín
 * bởi việc không còn ai làm nữa.
 */
export function loadPoolSpans(
  db: Db,
  params: { readonly from: string; readonly to: string },
): Array<{
  resourceId: string;
  resourceName: string;
  fromDate: string;
  toDate: string;
  allocation: number;
  effortMd: number;
  projectId: string;
  projectCode: string;
}> {
  const rows = db
    .prepare(
      `SELECT a.resource_id, r.name, a.from_date, a.to_date, a.allocation,
              COALESCE(t.effort_md, 0) AS effort_md,
              p.id AS project_id, p.code AS project_code
         FROM assignment a
         JOIN task t     ON t.uid = a.task_uid
         JOIN project p  ON p.id = t.project_id
         JOIN resource r ON r.id = a.resource_id
        WHERE a.from_date <= ? AND a.to_date >= ?
          AND p.status IN ('planning','active')
        ORDER BY a.resource_id, a.from_date, a.task_uid`,
    )
    .all(params.to, params.from) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    resourceName: r['name'] as string,
    fromDate: r['from_date'] as string,
    toDate: r['to_date'] as string,
    allocation: r['allocation'] as number,
    effortMd: r['effort_md'] as number,
    projectId: r['project_id'] as string,
    projectCode: r['project_code'] as string,
  }));
}

/** Dự án đang hoạt động, để S9 chú giải và sắp theo đúng thứ tự tranh chấp (§7.12). */
export function listActiveProjects(
  db: Db,
): Array<{ id: string; code: string; name: string; priority: number; status: string }> {
  const rows = db
    .prepare(
      `SELECT id, code, name, priority, status FROM project
        WHERE status IN ('planning','active')
        ORDER BY priority, code`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r['id'] as string,
    code: r['code'] as string,
    name: r['name'] as string,
    priority: r['priority'] as number,
    status: r['status'] as string,
  }));
}
