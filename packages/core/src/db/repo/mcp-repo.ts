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

/** Một task, tra thẳng bằng uid — `wbs_get_task` không cần tải cả cây. */
export function loadMcpTask(db: Db, uid: string): McpTaskRow | undefined {
  const row = db
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
        WHERE t.uid = ?`,
    )
    .get(uid) as Record<string, unknown> | undefined;

  return row === undefined ? undefined : toMcpTask(row);
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
  const sql =
    mode === 'cpm'
      ? `SELECT t.uid, t.wbs_code, t.name, s.start_date, s.end_date, s.total_float
           FROM task t JOIN schedule s ON s.task_uid = t.uid
          WHERE t.project_id = ? AND s.is_critical = 1
          ORDER BY s.start_date, t.wbs_code`
      : `SELECT t.uid, t.wbs_code, t.name, s.start_date, s.end_date, s.total_float
           FROM task t JOIN schedule s ON s.task_uid = t.uid
          WHERE t.project_id = ? AND s.is_resource_critical = 1
          ORDER BY s.start_date, t.wbs_code`;

  // Tie-break bằng `wbs_code` sau `start_date`: nhiều task cùng ngày bắt đầu là chuyện
  // thường, và thứ tự trả về phải xác định (N2).
  const rows = db.prepare(sql).all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    startDate: (r['start_date'] as string | null) ?? null,
    endDate: (r['end_date'] as string | null) ?? null,
    totalFloat: (r['total_float'] as number | null) ?? null,
  }));
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
    });

    cursor = reason === 'dependency' ? ref : null;
  }

  return { taskUid: uid, chain, truncated };
}
