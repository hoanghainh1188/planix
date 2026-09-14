/**
 * Cây WBS và mọi đường ghi vào nó — S1 (§10.4), tool ghi §12.2.
 *
 * Tách ra từ `read-repo.ts`, file đã phình tới 1362 dòng và trộn lẫn sáu nhóm không liên
 * quan. `read-repo.ts` nay chỉ còn là lớp tương thích re-export.
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3), prepared statement, không nối chuỗi.
 */

/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';
import { rollupTree, type RollupTask } from '../../domain/rollup.js';
import { checkMove, type MovableTask, type MoveRejection } from '../../domain/move.js';
import { renumber } from '../../domain/renumber.js';
import { maxTaskSequence } from './import-repo.js';
import type { ProgressStatus, TaskKind } from '../../domain/validation-types.js';

export interface WbsRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly childSequencing: string | null;
  /** §10.4 cho sửa inline `priority`, nên nó phải đi kèm dòng chứ không chỉ nằm trong DB. */
  readonly priority: number;
  readonly pic: string | null;
  readonly status: string;
  readonly percent: number;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly totalFloat: number | null;
  readonly isCritical: boolean;
  readonly delayReason: string | null;
  /** §10.4 "ô có issue: chấm đỏ góc phải" — mã issue của ĐÚNG run mới nhất. */
  readonly issueCodes: readonly string[];
  /**
   * Số ràng buộc chạm vào dòng này, tính cả hai chiều.
   *
   * Ràng buộc là thứ quyết định ngày của task, nhưng nó không nằm trên bảng WBS. Không có
   * con số này thì cách duy nhất để biết một dòng có bị nối hay không là mở panel từng
   * dòng một — mà cây thì hàng nghìn dòng.
   */
  readonly linkCount: number;
}

export function loadWbsTree(db: Db, projectId: string): WbsRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md, t.role,
              t.child_sequencing, t.priority, t.sort_order,
              r.name AS pic,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              s.start_date, s.end_date, s.total_float, s.is_critical, s.delay_reason
       FROM task t
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource r   ON r.id = a.resource_id
       WHERE t.project_id = ?
       ORDER BY t.wbs_code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  // Một truy vấn gộp sẵn, KHÔNG phải mỗi dòng một lần (CLAUDE.md §8 cấm N+1). Cũng
  // không JOIN vào câu trên: một task nhiều issue sẽ nhân đôi dòng của cây.
  const issueCodes = new Map<string, string[]>();
  const issueRows = db
    .prepare(
      // Lượt mới nhất lấy từ `validation_run`, KHÔNG phải từ dòng issue mới nhất. Một
      // lượt sạch không sinh dòng nào, nên hỏi bảng issue sẽ trả về run_id của lượt TRƯỚC
      // — tức là chấm đỏ của những vấn đề đã sửa xong vẫn còn nguyên trên cây.
      `SELECT task_uid, code
       FROM validation_issue
       WHERE task_uid IS NOT NULL AND run_pk = (
         SELECT id FROM validation_run WHERE project_id = ?
         ORDER BY id DESC LIMIT 1
       )
       ORDER BY code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  for (const r of issueRows) {
    const uid = r['task_uid'] as string;
    const list = issueCodes.get(uid);
    if (list === undefined) issueCodes.set(uid, [r['code'] as string]);
    else list.push(r['code'] as string);
  }

  // Cũng gộp một lần như trên. Cạnh nào cũng có hai đầu, nên UNION ALL rồi đếm theo uid
  // cho ra số cạnh CHẠM vào task — pred và succ gộp chung, đúng thứ dòng cây cần hiện.
  const linkCount = new Map<string, number>();
  const linkRows = db
    .prepare(
      `SELECT uid, COUNT(*) AS n FROM (
         SELECT d.succ_uid AS uid FROM dependency d
           JOIN task p ON p.uid = d.pred_uid
          WHERE p.project_id = ?
         UNION ALL
         SELECT d.pred_uid AS uid FROM dependency d
           JOIN task s ON s.uid = d.succ_uid
          WHERE s.project_id = ?
       ) GROUP BY uid`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
  for (const r of linkRows) linkCount.set(r['uid'] as string, r['n'] as number);

  // §7.7: summary KHÔNG có dữ liệu riêng — ngày, effort, status, % đều tính từ con
  // "lúc đọc", không lưu xuống. Bỏ bước này thì mọi dòng summary hiện ra rỗng trơn.
  const rollup = rollupTree(
    rows.map((r): RollupTask => ({
      uid: r['uid'] as string,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      kind: r['kind'] as TaskKind,
      effortMd: (r['effort_md'] as number | null) ?? null,
      status: r['status'] as ProgressStatus,
      percent: r['percent'] as number,
      planStart: (r['start_date'] as string | null) ?? null,
      planEnd: (r['end_date'] as string | null) ?? null,
    })),
  );

  return rows.map((r) => {
    const uid = r['uid'] as string;
    const kind = r['kind'] as string;
    const rolled = rollup.get(uid);
    const isSummary = kind === 'summary';

    return {
      uid,
      wbsCode: r['wbs_code'] as string,
      depth: r['depth'] as number,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      name: r['name'] as string,
      kind,
      // Summary hiện tổng MD của con; §7.7 cấm ghi số đó vào `task.effort_md`.
      effortMd: isSummary
        ? (rolled?.effortRollup ?? null)
        : ((r['effort_md'] as number | null) ?? null),
      role: (r['role'] as string | null) ?? null,
      childSequencing: (r['child_sequencing'] as string | null) ?? null,
      priority: r['priority'] as number,
      pic: (r['pic'] as string | null) ?? null,
      status: rolled?.status ?? (r['status'] as string),
      percent: rolled?.percentDisplay ?? (r['percent'] as number),
      planStart: rolled?.planStart ?? null,
      planEnd: rolled?.planEnd ?? null,
      // Float và đường găng chỉ có nghĩa trên task thật: CPM chạy trên lá, không trên
      // summary. Bịa một con số ở đây sẽ thành "đường găng" sai trên màn hình.
      totalFloat: isSummary ? null : ((r['total_float'] as number | null) ?? null),
      isCritical: !isSummary && r['is_critical'] === 1,
      delayReason: isSummary ? null : ((r['delay_reason'] as string | null) ?? null),
      issueCodes: issueCodes.get(uid) ?? [],
      linkCount: linkCount.get(uid) ?? 0,
    };
  });
}

export function teamOfTask(db: Db, taskUid: string): string | null {
  const r = db
    .prepare(
      `SELECT rt.team_id
       FROM task t
       JOIN assignment a ON a.task_uid = t.uid
       JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.uid = ?`,
    )
    .get(taskUid) as { team_id: string } | undefined;
  return r?.team_id ?? null;
}

export function projectOfTask(db: Db, taskUid: string): string | undefined {
  const r = db.prepare('SELECT project_id FROM task WHERE uid = ?').get(taskUid) as
    { project_id: string } | undefined;
  return r?.project_id;
}

/** S6 — danh sách issue của lần validate mới nhất. */
export interface IssueRow {
  // Cột `severity` đã có CHECK ba giá trị trong §4.2, nên kiểu ở đây phản ánh đúng thế.
  // Khai `string` là ném việc thu hẹp kiểu sang mọi nơi gọi.
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly code: string;
  readonly taskUid: string | null;
  readonly message: string;
  readonly detectedAt: string;
}

export function loadIssues(db: Db, projectId: string): IssueRow[] {
  const rows = db
    .prepare(
      `SELECT severity, code, task_uid, message, detected_at
       FROM validation_issue
       WHERE run_pk = (
         SELECT id FROM validation_run WHERE project_id = ?
         ORDER BY id DESC LIMIT 1
       )
       ORDER BY severity, code, task_uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    severity: r['severity'] as IssueRow['severity'],
    code: r['code'] as string,
    taskUid: (r['task_uid'] as string | null) ?? null,
    message: r['message'] as string,
    detectedAt: r['detected_at'] as string,
  }));
}

/**
 * Issue của MỘT lượt cụ thể — để xem lại một mốc trong lịch sử.
 *
 * Tách khỏi `loadIssues` thay vì thêm tham số tuỳ chọn: người gọi hoặc muốn "hiện tại",
 * hoặc muốn "lượt đó". Gộp làm một hàm thì chỗ gọi nào quên truyền sẽ lặng lẽ nhận thứ
 * khác với ý định.
 */
export function loadIssuesOfRun(db: Db, runPk: number): IssueRow[] {
  const rows = db
    .prepare(
      `SELECT severity, code, task_uid, message, detected_at
       FROM validation_issue
       WHERE run_pk = ?
       ORDER BY severity, code, task_uid`,
    )
    .all(runPk) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    severity: r['severity'] as IssueRow['severity'],
    code: r['code'] as string,
    taskUid: (r['task_uid'] as string | null) ?? null,
    message: r['message'] as string,
    detectedAt: r['detected_at'] as string,
  }));
}

export interface TaskEditableFields {
  readonly name: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly priority: number;
}

export function loadTaskForEdit(db: Db, taskUid: string): TaskEditableFields | undefined {
  const r = db
    .prepare('SELECT name, effort_md, role, priority FROM task WHERE uid = ?')
    .get(taskUid) as
    { name: string; effort_md: number | null; role: string | null; priority: number } | undefined;
  if (r === undefined) return undefined;
  return { name: r.name, effortMd: r.effort_md, role: r.role, priority: r.priority };
}

export function updateTaskFields(
  db: Db,
  taskUid: string,
  fields: TaskEditableFields,
  now: string,
): void {
  db.prepare(
    'UPDATE task SET name = ?, effort_md = ?, role = ?, priority = ?, updated_at = ? WHERE uid = ?',
  ).run(fields.name, fields.effortMd, fields.role, fields.priority, now, taskUid);
}

/**
 * Ghim người vào một task, hoặc gỡ ghim khi `resourceId === null` (§7.8).
 *
 * `pinned_resource` có từ migration 001 nhưng tới giờ **chỉ importer ghi được** — không
 * màn nào trong §10.4 cho sửa nó, nên trước lớp MCP thì cách duy nhất để ghim một người
 * là nạp lại cả file. §12.2 yêu cầu `wbs_pin_resource`, nên đường ghi đó phải có thật.
 *
 * Trả về `false` khi không có task nào mang uid đó — người gọi phân biệt được "đã ghim"
 * với "gõ nhầm uid", hai thứ cần phản ứng khác nhau.
 *
 * Engine KHÔNG được tự đổi người đã ghim (N4): nó chỉ được báo `J01` nếu việc ghim gây
 * quá tải. Ràng buộc đó nằm ở `sgs.ts`, không ở đây.
 */
export function setPinnedResource(
  db: Db,
  taskUid: string,
  resourceId: string | null,
  now: string,
): boolean {
  return (
    db
      .prepare('UPDATE task SET pinned_resource = ?, updated_at = ? WHERE uid = ?')
      .run(resourceId, now, taskUid).changes > 0
  );
}

/** Người đang bị ghim vào task, để ghi nhật ký giá trị trước khi đổi. */
export function loadPinnedResource(db: Db, taskUid: string): string | null | undefined {
  const r = db.prepare('SELECT pinned_resource FROM task WHERE uid = ?').get(taskUid) as
    { pinned_resource: string | null } | undefined;
  return r === undefined ? undefined : r.pinned_resource;
}

/**
 * Nhóm nhãn phân loại — những trường S2 cho sửa (quyết định 2026-09-14).
 *
 * Đây là nhóm DUY NHẤT trước nay không có đường ghi nào trong web: `phase` chỉ được đọc
 * để lọc Gantt. Hệ quả là rule `N03` báo "leaf thiếu phase và module" mà PM không sửa
 * được, trừ khi nạp lại cả file import.
 *
 * KHÔNG gộp vào `TaskEditableFields`: hai nhóm sửa ở hai màn khác nhau (S1 inline, S2
 * panel), và gộp lại thì mỗi lần lưu một bên sẽ ghi đè bên kia bằng giá trị cũ nó đang
 * giữ trong state.
 */
export interface TaskLabelFields {
  readonly description: string | null;
  readonly category: string | null;
  readonly phase: string | null;
  readonly module: string | null;
  readonly externalRef: string | null;
}

export function loadTaskLabels(db: Db, taskUid: string): TaskLabelFields | undefined {
  const r = db
    .prepare('SELECT description, category, phase, module, external_ref FROM task WHERE uid = ?')
    .get(taskUid) as Record<string, unknown> | undefined;
  if (r === undefined) return undefined;
  return {
    description: (r['description'] as string | null) ?? null,
    category: (r['category'] as string | null) ?? null,
    phase: (r['phase'] as string | null) ?? null,
    module: (r['module'] as string | null) ?? null,
    externalRef: (r['external_ref'] as string | null) ?? null,
  };
}

export function updateTaskLabels(
  db: Db,
  taskUid: string,
  fields: TaskLabelFields,
  now: string,
): void {
  db.prepare(
    `UPDATE task SET description = ?, category = ?, phase = ?, module = ?, external_ref = ?,
                     updated_at = ?
      WHERE uid = ?`,
  ).run(
    fields.description,
    fields.category,
    fields.phase,
    fields.module,
    fields.externalRef,
    now,
    taskUid,
  );
}

// ── Đường GHI của S1: đổi cha, đổi thứ tự, đổi sequencing (§10.4) ───────────

export class MoveRejectedError extends Error {
  constructor(readonly reason: MoveRejection) {
    super(`Move rejected: ${reason}`);
    this.name = 'MoveRejectedError';
  }
}

export interface MoveResult {
  readonly projectId: string;
  /** Số task bị đổi `wbs_code` — dùng để báo cho người dùng biết phạm vi ảnh hưởng. */
  readonly renumbered: number;
}

/**
 * Đổi cha và/hoặc thứ tự của một task, rồi ĐÁNH SỐ LẠI cả dự án (§10.4).
 *
 * Renumber cả dự án chứ không chỉ nhánh bị đụng: `wbs_code` của một task phụ thuộc vị trí
 * của mọi anh em đứng trước nó, nên chuyển một nhánh có thể dịch số của nhánh khác. Đánh
 * số một phần là cách chắc chắn để hai task cùng mang một mã.
 *
 * Người gọi phải bọc trong transaction: đổi cha mà renumber hỏng giữa chừng thì cây còn
 * tệ hơn lúc chưa đụng vào.
 */
export function moveTask(
  db: Db,
  p: {
    taskUid: string;
    newParentUid: string | null;
    newSortOrder: number;
    now: string;
  },
): MoveResult {
  const projectId = projectOfTask(db, p.taskUid);
  if (projectId === undefined) throw new MoveRejectedError('unknown-task');

  // Nạp cả HAI dự án liên quan thì mới phát hiện được phép chuyển xuyên dự án; nạp mỗi
  // dự án hiện tại sẽ khiến cha ở dự án khác trông như "không tồn tại".
  const rows = db.prepare('SELECT uid, project_id, parent_uid FROM task').all() as Array<
    Record<string, unknown>
  >;
  const tasks: MovableTask[] = rows.map((r) => ({
    uid: r['uid'] as string,
    projectId: r['project_id'] as string,
    parentUid: (r['parent_uid'] as string | null) ?? null,
  }));

  const rejection = checkMove(tasks, p.taskUid, p.newParentUid);
  if (rejection !== null) throw new MoveRejectedError(rejection);

  db.prepare('UPDATE task SET parent_uid = ?, sort_order = ?, updated_at = ? WHERE uid = ?').run(
    p.newParentUid,
    p.newSortOrder,
    p.now,
    p.taskUid,
  );

  const inProject = db
    .prepare('SELECT uid, parent_uid, sort_order FROM task WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>;

  const before = new Map(
    db
      .prepare('SELECT uid, wbs_code FROM task WHERE project_id = ?')
      .all(projectId)
      .map((r) => [(r as { uid: string }).uid, (r as { wbs_code: string }).wbs_code]),
  );

  let renumbered = 0;
  const update = db.prepare('UPDATE task SET wbs_code = ?, depth = ? WHERE uid = ?');
  for (const r of renumber(
    inProject.map((t) => ({
      uid: t['uid'] as string,
      parentUid: (t['parent_uid'] as string | null) ?? null,
      sortOrder: t['sort_order'] as number,
    })),
  )) {
    if (before.get(r.uid) !== r.wbsCode) renumbered++;
    update.run(r.wbsCode, r.depth, r.uid);
  }

  return { projectId, renumbered };
}

/** §10.4 — công tắc Parallel / Sequential trên dòng summary (§6.3). */
export function setSequencing(
  db: Db,
  taskUid: string,
  mode: 'parallel' | 'sequential',
  now: string,
): void {
  db.prepare('UPDATE task SET child_sequencing = ?, updated_at = ? WHERE uid = ?').run(
    mode,
    now,
    taskUid,
  );
}

export function loadTaskKind(db: Db, taskUid: string): string | undefined {
  const r = db.prepare('SELECT kind FROM task WHERE uid = ?').get(taskUid) as
    { kind: string } | undefined;
  return r?.kind;
}

// ── Tạo / xoá task, sửa dependency (§10.4, §12.2) ───────────────────────────

/** Đánh số lại cả dự án. Tách ra vì cả tạo, xoá lẫn chuyển đều cần. */
function renumberProject(db: Db, projectId: string): number {
  const rows = db
    .prepare('SELECT uid, parent_uid, sort_order, wbs_code FROM task WHERE project_id = ?')
    .all(projectId) as Array<Record<string, unknown>>;

  const before = new Map(rows.map((r) => [r['uid'] as string, r['wbs_code'] as string]));
  const update = db.prepare('UPDATE task SET wbs_code = ?, depth = ? WHERE uid = ?');
  let changed = 0;

  for (const r of renumber(
    rows.map((t) => ({
      uid: t['uid'] as string,
      parentUid: (t['parent_uid'] as string | null) ?? null,
      sortOrder: t['sort_order'] as number,
    })),
  )) {
    if (before.get(r.uid) !== r.wbsCode) changed++;
    update.run(r.wbsCode, r.depth, r.uid);
  }
  return changed;
}

export interface CreateTaskInput {
  readonly projectId: string;
  /** `null` = tạo ở gốc cây. */
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: 'summary' | 'work' | 'milestone';
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly priority: number;
  /** Chèn NGAY SAU anh em này. Bỏ trống thì thêm vào cuối. */
  readonly afterUid?: string | null;
  readonly now: string;
}

export interface CreateTaskResult {
  readonly uid: string;
  readonly wbsCode: string;
  readonly renumbered: number;
}

/**
 * Thêm một task vào cây (§10.4).
 *
 * Cho tới trước hàm này, đường DUY NHẤT ghi vào bảng `task` là importer — muốn thêm một
 * dòng thì phải sửa file JSON rồi nạp lại cả gói. Với một tool lập kế hoạch thì đó là lỗ
 * hổng cơ bản nhất.
 *
 * Người gọi phải bọc transaction: chèn xong mà renumber hỏng giữa chừng sẽ để lại hai
 * task cùng `wbs_code`.
 */
export function createTask(db: Db, input: CreateTaskInput): CreateTaskResult {
  if (input.parentUid !== null) {
    const parent = db.prepare('SELECT project_id FROM task WHERE uid = ?').get(input.parentUid) as
      { project_id: string } | undefined;
    if (parent === undefined) throw new Error('Cha không tồn tại');
    // Cây WBS thuộc về đúng một dự án; cho phép chèn xuyên dự án là mở cửa cho C08.
    if (parent.project_id !== input.projectId) throw new Error('Cha thuộc dự án khác');
  }

  // Chèn vào giữa bằng cách lấy sort_order của anh em đứng trước + 1, rồi đẩy phần còn
  // lại xuống. Renumber ngay sau đó nên khoảng cách số không cần đẹp.
  let sortOrder: number;
  if (input.afterUid === undefined || input.afterUid === null) {
    const last = db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM task WHERE project_id = ? AND parent_uid IS ?',
      )
      .get(input.projectId, input.parentUid) as { m: number };
    sortOrder = last.m + 1;
  } else {
    const sibling = db.prepare('SELECT sort_order FROM task WHERE uid = ?').get(input.afterUid) as
      { sort_order: number } | undefined;
    if (sibling === undefined) throw new Error('Anh em để chèn sau không tồn tại');
    sortOrder = sibling.sort_order + 1;
    db.prepare(
      `UPDATE task SET sort_order = sort_order + 1
       WHERE project_id = ? AND parent_uid IS ? AND sort_order >= ?`,
    ).run(input.projectId, input.parentUid, sortOrder);
  }

  const uid = `T-${String(maxTaskSequence(db) + 1).padStart(4, '0')}`;
  db.prepare(
    `INSERT INTO task (uid, project_id, wbs_code, depth, parent_uid, sort_order, name, kind,
                       effort_md, role, priority, created_at, updated_at)
     VALUES (?, ?, '', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid,
    input.projectId,
    input.parentUid,
    sortOrder,
    input.name,
    input.kind,
    input.effortMd,
    input.role,
    input.priority,
    input.now,
    input.now,
  );

  const renumbered = renumberProject(db, input.projectId);
  const row = db.prepare('SELECT wbs_code FROM task WHERE uid = ?').get(uid) as {
    wbs_code: string;
  };
  return { uid, wbsCode: row.wbs_code, renumbered };
}

export interface SubtreeInfo {
  readonly uids: readonly string[];
  /** Số dòng tiến độ sẽ mất theo. Người dùng phải biết trước khi xoá. */
  readonly progressRows: number;
}

/**
 * Những gì sẽ mất nếu xoá cây con này — §12.2: "trả về số task sẽ mất, cần confirm".
 *
 * Xoá một summary kéo theo toàn bộ nhánh, và `ON DELETE CASCADE` kéo theo cả tiến độ đã
 * nhập. Hỏi trước là bắt buộc: lịch thì tính lại được, tiến độ do người gõ thì không.
 */
export function subtreeOf(db: Db, rootUid: string): SubtreeInfo {
  const all = db.prepare('SELECT uid, parent_uid FROM task').all() as Array<
    Record<string, unknown>
  >;
  const children = new Map<string, string[]>();
  for (const r of all) {
    const parent = (r['parent_uid'] as string | null) ?? null;
    if (parent === null) continue;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [r['uid'] as string]);
    else list.push(r['uid'] as string);
  }

  const uids: string[] = [];
  const stack = [rootUid];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const uid = stack.pop();
    if (uid === undefined || seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
    for (const c of children.get(uid) ?? []) stack.push(c);
  }
  uids.sort();

  const holes = uids.map(() => '?').join(',');
  const progress = db
    .prepare(`SELECT COUNT(*) AS n FROM progress WHERE task_uid IN (${holes})`)
    .get(...uids) as { n: number };

  return { uids, progressRows: progress.n };
}

/** Xoá cả cây con. Người gọi phải hỏi xác nhận trước — xem `subtreeOf`. */
export function deleteSubtree(db: Db, rootUid: string, projectId: string): number {
  const info = subtreeOf(db, rootUid);
  const holes = info.uids.map(() => '?').join(',');
  // `ON DELETE CASCADE` lo dependency, schedule, assignment, progress.
  db.prepare(`DELETE FROM task WHERE uid IN (${holes})`).run(...info.uids);
  renumberProject(db, projectId);
  return info.uids.length;
}

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** §12.2 `wbs_set_dependency`. Đặt lại cùng cặp+loại thì cập nhật `lag`, không nhân đôi. */
export function setDependency(
  db: Db,
  p: { predUid: string; succUid: string; type: DependencyType; lagDays: number },
): void {
  if (p.predUid === p.succUid) throw new Error('Task không thể phụ thuộc chính nó');
  db.prepare(
    `INSERT INTO dependency (pred_uid, succ_uid, type, lag_days) VALUES (?, ?, ?, ?)
     ON CONFLICT(pred_uid, succ_uid, type) DO UPDATE SET lag_days = excluded.lag_days`,
  ).run(p.predUid, p.succUid, p.type, p.lagDays);
}

export function deleteDependency(
  db: Db,
  p: { predUid: string; succUid: string; type: DependencyType },
): number {
  return db
    .prepare('DELETE FROM dependency WHERE pred_uid = ? AND succ_uid = ? AND type = ?')
    .run(p.predUid, p.succUid, p.type).changes;
}

/** Một đầu bên kia của một ràng buộc, kèm đủ thứ để hiện thành một dòng đọc được. */
export interface TaskDependency {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly kind: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly type: DependencyType;
  readonly lagDays: number;
}

export interface TaskDependencies {
  /** Task phải xong (hoặc bắt đầu) trước — cạnh trỏ VÀO task đang xem. */
  readonly predecessors: readonly TaskDependency[];
  /** Task chờ task đang xem — cạnh trỏ RA. */
  readonly successors: readonly TaskDependency[];
}

/**
 * Mọi ràng buộc chạm vào một task, cả hai chiều.
 *
 * Trả về tên và mã WBS của đầu bên kia chứ không chỉ `uid`: panel nào cũng phải hiện
 * "1.2 Thiết kế API", và để client tự tra ngược trong cây đã tải là đẩy việc ghép dữ
 * liệu sang chỗ không nắm được nguồn (§10.1).
 *
 * Hai truy vấn cố định, không phụ thuộc số cạnh (CLAUDE.md §8 cấm N+1). Sắp theo
 * `wbs_code` rồi `type` — hai cạnh cùng cặp task (SS+FF, §6.4) vẫn ra thứ tự cố định (N2).
 */
export function loadTaskDependencies(db: Db, taskUid: string): TaskDependencies {
  const select = (joinColumn: 'pred_uid' | 'succ_uid', whereColumn: 'succ_uid' | 'pred_uid') =>
    db
      .prepare(
        `SELECT t.uid, t.wbs_code, t.name, t.kind, t.depth, t.parent_uid, d.type, d.lag_days
           FROM dependency d
           JOIN task t ON t.uid = d.${joinColumn}
          WHERE d.${whereColumn} = ?
          ORDER BY t.wbs_code, d.type`,
      )
      .all(taskUid) as Array<Record<string, unknown>>;

  const toDependency = (r: Record<string, unknown>): TaskDependency => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    kind: r['kind'] as string,
    depth: r['depth'] as number,
    parentUid: (r['parent_uid'] as string | null) ?? null,
    type: r['type'] as DependencyType,
    lagDays: r['lag_days'] as number,
  });

  return {
    predecessors: select('pred_uid', 'succ_uid').map(toDependency),
    successors: select('succ_uid', 'pred_uid').map(toDependency),
  };
}
