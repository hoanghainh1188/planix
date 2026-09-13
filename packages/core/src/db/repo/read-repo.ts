/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';
import { rollupTree, type RollupTask } from '../../domain/rollup.js';
import { isMicroTask } from '../../domain/rollup.js';
import { createCalendarEngine } from '../../domain/calendar.js';
import { checkMove, type MovableTask, type MoveRejection } from '../../domain/move.js';
import { renumber } from '../../domain/renumber.js';
import { maxTaskSequence } from './import-repo.js';
import { unsafeDateOnly } from '../../domain/date-only.js';
import { suggestProgress, type Suggestion } from '../../domain/progress-suggest.js';
import { loadCalendarSnapshot } from './calendar-repo.js';
import { listBaselines, readBaselineSnapshot } from './baseline-repo.js';
import { computeEvm, type EvmResult, type EvmTask } from '../../domain/evm.js';
import type { ProgressStatus, TaskKind } from '../../domain/validation-types.js';

/** S1 — một dòng của cây WBS (§10.4 danh sách cột). */
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
      `SELECT task_uid, code
       FROM validation_issue
       WHERE project_id = ? AND task_uid IS NOT NULL AND run_id = (
         SELECT run_id FROM validation_issue WHERE project_id = ?
         ORDER BY detected_at DESC, id DESC LIMIT 1
       )
       ORDER BY code`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
  for (const r of issueRows) {
    const uid = r['task_uid'] as string;
    const list = issueCodes.get(uid);
    if (list === undefined) issueCodes.set(uid, [r['code'] as string]);
    else list.push(r['code'] as string);
  }

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
    };
  });
}

/** S4 — dòng nhập tiến độ, kèm team để lead chỉ thấy team mình (§10.5, §10.6). */
export interface ProgressRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly effortMd: number | null;
  readonly status: string;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly teamId: string | null;
}

export function loadProgressRows(db: Db, projectId: string, teamId: string | null): ProgressRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, t.effort_md,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              p.actual_start, p.actual_end,
              s.start_date, s.end_date,
              rt.team_id
       FROM task t
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.project_id = ? AND t.kind != 'summary'
         AND (? IS NULL OR rt.team_id = ?)
       ORDER BY t.wbs_code`,
    )
    .all(projectId, teamId, teamId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    effortMd: (r['effort_md'] as number | null) ?? null,
    status: r['status'] as string,
    percent: r['percent'] as number,
    actualStart: (r['actual_start'] as string | null) ?? null,
    actualEnd: (r['actual_end'] as string | null) ?? null,
    planStart: (r['start_date'] as string | null) ?? null,
    planEnd: (r['end_date'] as string | null) ?? null,
    teamId: (r['team_id'] as string | null) ?? null,
  }));
}

/** Team của một task, để kiểm quyền lead trước khi cho ghi (§10.6). */
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
       WHERE project_id = ? AND run_id = (
         SELECT run_id FROM validation_issue WHERE project_id = ?
         ORDER BY detected_at DESC, id DESC LIMIT 1
       )
       ORDER BY severity, code, task_uid`,
    )
    .all(projectId, projectId) as Array<Record<string, unknown>>;
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

export function upsertProgress(
  db: Db,
  p: {
    taskUid: string;
    status: string;
    percent: number;
    actualStart: string | null;
    actualEnd: string | null;
    blockedNote: string | null;
    updatedBy: string;
    source: 'ui' | 'api' | 'mcp';
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO progress (task_uid, status, percent, actual_start, actual_end, blocked_note, updated_by, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_uid) DO UPDATE SET
       status = excluded.status, percent = excluded.percent,
       actual_start = excluded.actual_start, actual_end = excluded.actual_end,
       blocked_note = excluded.blocked_note,
       updated_by = excluded.updated_by, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(
    p.taskUid,
    p.status,
    p.percent,
    p.actualStart,
    p.actualEnd,
    p.blockedNote,
    p.updatedBy,
    p.source,
    p.now,
  );
}

// ── S4 — bảng nhập tiến độ (§10.5) ──────────────────────────────────────────

/** Trạng thái đã lưu; `null` nghĩa là chưa ai nhập dòng này bao giờ. */
export interface SavedProgress {
  readonly status: string;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
}

export interface ProgressBoardRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly parentUid: string | null;
  /** Tên summary cha — §10.5 gom micro task "theo cụm cha". */
  readonly parentName: string | null;
  readonly effortMd: number | null;
  readonly pic: string | null;
  readonly teamId: string | null;
  readonly isMicro: boolean;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly saved: SavedProgress | null;
  readonly suggestion: Suggestion;
  /**
   * Nhận đề xuất thì KHÔNG có gì đổi — lead không phải quyết định gì ở dòng này.
   *
   * §10.5 gom những dòng như thế thành một dòng "142 tasks on track". Spec viết "khớp đề
   * xuất và chưa từng bị sửa"; hai vế đó là một khi so trạng thái HIỆU LỰC (chưa nhập thì
   * mặc định `not_started`/0) với đề xuất. Xem docs/decisions/2026-09-13-s4-on-track.md.
   */
  readonly onTrack: boolean;
}

export interface ProgressBoard {
  readonly statusDate: string;
  readonly microThreshold: number;
  readonly rows: readonly ProgressBoardRow[];
}

/**
 * Dựng toàn bộ dữ liệu S4 trong MỘT lượt đọc, kèm đề xuất của engine.
 *
 * Đề xuất tính ở server chứ không ở client vì nó cần lịch làm việc (§5) để biết đã trôi
 * bao nhiêu NGÀY CÔNG — và §10.1 nói thẳng: "mọi số hiển thị đọc từ schedule, không tính
 * lại ở client".
 */
export function loadProgressBoard(db: Db, projectId: string, teamId: string | null): ProgressBoard {
  const project = db
    .prepare('SELECT status_date, micro_task_threshold, calendar_id FROM project WHERE id = ?')
    .get(projectId) as
    { status_date: string; micro_task_threshold: number; calendar_id: string } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${projectId}`);

  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, t.kind, t.effort_md, t.parent_uid,
              parent.name AS parent_name,
              r.name AS pic,
              rt.team_id,
              s.start_date, s.end_date, s.duration_days,
              p.status, p.percent, p.actual_start, p.actual_end, p.blocked_note
       FROM task t
       LEFT JOIN task parent   ON parent.uid = t.parent_uid
       LEFT JOIN schedule s    ON s.task_uid = t.uid
       LEFT JOIN progress p    ON p.task_uid = t.uid
       LEFT JOIN assignment a  ON a.task_uid = t.uid
       LEFT JOIN resource r    ON r.id = a.resource_id
       LEFT JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.project_id = ? AND t.kind != 'summary'
         AND (? IS NULL OR rt.team_id = ?)
       ORDER BY t.wbs_code`,
    )
    .all(projectId, teamId, teamId) as Array<Record<string, unknown>>;

  // Engine lịch dựng MỘT lần cho cả bảng — dựng theo từng dòng là N+1 trá hình.
  const calendar = createCalendarEngine(loadCalendarSnapshot(db));
  const statusDate = project.status_date;

  const board = rows.map((r): ProgressBoardRow => {
    const planStart = (r['start_date'] as string | null) ?? null;
    const planEnd = (r['end_date'] as string | null) ?? null;
    const effortMd = (r['effort_md'] as number | null) ?? null;

    const isMicro = isMicroTask(
      { kind: r['kind'] as 'work' | 'milestone', effortMd },
      project.micro_task_threshold,
    );

    // Chỉ đếm khi task đã bắt đầu; ngoài khoảng đó `workingDaysBetween` trả số âm.
    const elapsed =
      planStart !== null && planStart <= statusDate
        ? calendar.workingDaysBetween(
            project.calendar_id,
            unsafeDateOnly(planStart),
            unsafeDateOnly(statusDate),
          )
        : 0;

    const suggestion = suggestProgress({
      planStart,
      planEnd,
      statusDate,
      isMicro,
      durationDays: (r['duration_days'] as number | null) ?? 0,
      elapsedWorkingDays: elapsed,
    });

    const saved: SavedProgress | null =
      r['status'] === null || r['status'] === undefined
        ? null
        : {
            status: r['status'] as string,
            percent: r['percent'] as number,
            actualStart: (r['actual_start'] as string | null) ?? null,
            actualEnd: (r['actual_end'] as string | null) ?? null,
            blockedNote: (r['blocked_note'] as string | null) ?? null,
          };

    // Trạng thái hiệu lực: chưa nhập thì là mặc định của bảng `progress`.
    const currentStatus = saved?.status ?? 'not_started';
    const currentPercent = saved?.percent ?? 0;

    return {
      uid: r['uid'] as string,
      wbsCode: r['wbs_code'] as string,
      name: r['name'] as string,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      parentName: (r['parent_name'] as string | null) ?? null,
      effortMd,
      pic: (r['pic'] as string | null) ?? null,
      teamId: (r['team_id'] as string | null) ?? null,
      isMicro,
      planStart,
      planEnd,
      saved,
      suggestion,
      onTrack: currentStatus === suggestion.status && currentPercent === suggestion.percent,
    };
  });

  return { statusDate, microThreshold: project.micro_task_threshold, rows: board };
}

/**
 * Ngữ cảnh để server tự kiểm ràng buộc §10.5, KHÔNG tin client.
 *
 * Một truy vấn cho cả lô — kiểm từng dòng bằng một query riêng chính là N+1 mà
 * CLAUDE.md §8 cấm.
 */
export function loadEntryContext(
  db: Db,
  taskUids: readonly string[],
): Map<string, { isMicro: boolean; statusDate: string }> {
  const out = new Map<string, { isMicro: boolean; statusDate: string }>();
  if (taskUids.length === 0) return out;

  const holes = taskUids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT t.uid, t.kind, t.effort_md, pr.status_date, pr.micro_task_threshold
       FROM task t
       JOIN project pr ON pr.id = t.project_id
       WHERE t.uid IN (${holes})`,
    )
    .all(...taskUids) as Array<Record<string, unknown>>;

  for (const r of rows) {
    out.set(r['uid'] as string, {
      isMicro: isMicroTask(
        { kind: r['kind'] as TaskKind, effortMd: (r['effort_md'] as number | null) ?? null },
        r['micro_task_threshold'] as number,
      ),
      statusDate: r['status_date'] as string,
    });
  }
  return out;
}

// ── S3 — Gantt (§10.3, §14.2/P9) ────────────────────────────────────────────

export interface GanttRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: string;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly isCritical: boolean;
  readonly pic: string | null;
  readonly teamId: string | null;
  readonly phase: string | null;
}

/**
 * Dữ liệu cho Gantt — CHỈ ĐỌC (N3: không kéo thả đổi ngày).
 *
 * Trả cả summary lẫn task lá: summary vẽ thành thanh bao, ngày lấy từ rollup §7.7 giống
 * hệt S1 để hai màn hình không bao giờ nói hai con số khác nhau.
 */
export function loadGanttRows(db: Db, projectId: string): GanttRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.name, t.depth, t.kind, t.effort_md, t.parent_uid, t.phase,
              r.name AS pic,
              rt.team_id,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              s.start_date, s.end_date, s.is_critical
       FROM task t
       LEFT JOIN schedule s    ON s.task_uid = t.uid
       LEFT JOIN progress p    ON p.task_uid = t.uid
       LEFT JOIN assignment a  ON a.task_uid = t.uid
       LEFT JOIN resource r    ON r.id = a.resource_id
       LEFT JOIN resource_team rt ON rt.resource_id = a.resource_id AND rt.project_id = t.project_id
       WHERE t.project_id = ?
       ORDER BY t.wbs_code`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

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
    const rolled = rollup.get(uid);
    const isSummary = r['kind'] === 'summary';
    return {
      uid,
      wbsCode: r['wbs_code'] as string,
      name: r['name'] as string,
      depth: r['depth'] as number,
      kind: r['kind'] as string,
      planStart: rolled?.planStart ?? null,
      planEnd: rolled?.planEnd ?? null,
      isCritical: !isSummary && r['is_critical'] === 1,
      pic: (r['pic'] as string | null) ?? null,
      teamId: (r['team_id'] as string | null) ?? null,
      phase: (r['phase'] as string | null) ?? null,
    };
  });
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

// ── Ảnh chụp lịch, cho bảng so sánh trước/sau (§10.1) ────────────────────────

export interface ScheduleSnapshotRow {
  readonly taskUid: string;
  readonly projectId: string;
  readonly wbsCode: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/**
 * Lịch của MỌI dự án, không chỉ dự án đang mở.
 *
 * §10.1 bắt bảng so sánh phải "gộp mọi dự án bị ảnh hưởng", và R9 nêu đúng rủi ro: chạy
 * lại lịch dự án này có thể đẩy dự án khác mà PM bên đó không hề biết.
 */
export function loadScheduleSnapshot(db: Db): ScheduleSnapshotRow[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.project_id, t.wbs_code, t.name, s.start_date, s.end_date
       FROM task t
       JOIN schedule s ON s.task_uid = t.uid
       ORDER BY t.project_id, t.wbs_code`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    taskUid: r['uid'] as string,
    projectId: r['project_id'] as string,
    wbsCode: r['wbs_code'] as string,
    name: r['name'] as string,
    startDate: (r['start_date'] as string | null) ?? null,
    endDate: (r['end_date'] as string | null) ?? null,
  }));
}

// ── Read model cho báo cáo Excel (§11) ──────────────────────────────────────

export interface ReportRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: string;
  /** §11.2 cột C: trống thì lấy `phase`. */
  readonly category: string | null;
  readonly pic: string | null;
  readonly status: string;
  readonly percent: number;
  readonly effortMd: number | null;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
  readonly isMicro: boolean;
  /** §11.2 cột L, đã dựng sẵn dạng `1.2.3 FS`, `2.1 SS+2`. */
  readonly dependsOn: string;
}

export interface ReportData {
  readonly projectCode: string;
  readonly projectName: string;
  readonly statusDate: string;
  readonly microThreshold: number;
  readonly rows: readonly ReportRow[];
}

/**
 * Toàn bộ dữ liệu một bản báo cáo cần, trong một lượt đọc.
 *
 * §11.5 đòi "cùng DB + cùng status_date → cùng file, kể cả thứ tự dòng", nên thứ tự ở
 * đây phải tất định. SQL `ORDER BY wbs_code` sắp theo chuỗi (1.10 trước 1.2), nên việc
 * sắp xếp để lớp gọi làm bằng natural sort — cùng một hàm với ba màn hình.
 */
export function loadReportData(db: Db, projectId: string): ReportData {
  const project = db
    .prepare('SELECT code, name, status_date, micro_task_threshold FROM project WHERE id = ?')
    .get(projectId) as
    { code: string; name: string; status_date: string; micro_task_threshold: number } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${projectId}`);

  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.depth, t.parent_uid, t.name, t.kind, t.effort_md,
              t.category, t.phase,
              r.name AS pic,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              p.actual_start, p.actual_end, p.blocked_note,
              s.start_date, s.end_date
       FROM task t
       LEFT JOIN schedule s   ON s.task_uid = t.uid
       LEFT JOIN progress p   ON p.task_uid = t.uid
       LEFT JOIN assignment a ON a.task_uid = t.uid
       LEFT JOIN resource r   ON r.id = a.resource_id
       WHERE t.project_id = ?`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  // Nhãn dependency dựng bằng MỘT truy vấn cho cả dự án, không phải mỗi task một lần.
  const deps = new Map<string, string[]>();
  const depRows = db
    .prepare(
      `SELECT d.succ_uid, pt.wbs_code AS pred_code, d.type, d.lag_days
       FROM dependency d
       JOIN task pt ON pt.uid = d.pred_uid
       JOIN task st ON st.uid = d.succ_uid
       WHERE st.project_id = ?`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  for (const d of depRows) {
    const lag = d['lag_days'] as number;
    // §11.2 nêu ví dụ `2.1 SS+2`: chỉ ghi lag khi khác 0, và giữ dấu.
    const suffix = lag === 0 ? '' : lag > 0 ? `+${String(lag)}` : String(lag);
    const label = `${String(d['pred_code'])} ${String(d['type'])}${suffix}`;
    const succ = d['succ_uid'] as string;
    const list = deps.get(succ);
    if (list === undefined) deps.set(succ, [label]);
    else list.push(label);
  }
  // Sắp nhãn để hai lần xuất ra cùng một chuỗi (§11.5).
  for (const list of deps.values()) list.sort();

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

  const report = rows.map((r): ReportRow => {
    const uid = r['uid'] as string;
    const kind = r['kind'] as string;
    const isSummary = kind === 'summary';
    const rolled = rollup.get(uid);
    const effortMd = (r['effort_md'] as number | null) ?? null;

    return {
      uid,
      wbsCode: r['wbs_code'] as string,
      depth: r['depth'] as number,
      parentUid: (r['parent_uid'] as string | null) ?? null,
      name: r['name'] as string,
      kind,
      // §11.2 cột C: "Trống thì lấy `phase`".
      category: (r['category'] as string | null) ?? (r['phase'] as string | null) ?? null,
      // §11.2 cột D: "Summary để trống".
      pic: isSummary ? null : ((r['pic'] as string | null) ?? null),
      status: rolled?.status ?? (r['status'] as string),
      percent: rolled?.percentDisplay ?? (r['percent'] as number),
      effortMd: isSummary ? (rolled?.effortRollup ?? null) : effortMd,
      planStart: rolled?.planStart ?? null,
      planEnd: rolled?.planEnd ?? null,
      actualStart: (r['actual_start'] as string | null) ?? null,
      actualEnd: (r['actual_end'] as string | null) ?? null,
      blockedNote: (r['blocked_note'] as string | null) ?? null,
      isMicro: isMicroTask({ kind: kind as TaskKind, effortMd }, project.micro_task_threshold),
      dependsOn: (deps.get(uid) ?? []).join(', '),
    };
  });

  return {
    projectCode: project.code,
    projectName: project.name,
    statusDate: project.status_date,
    microThreshold: project.micro_task_threshold,
    rows: report,
  };
}

export interface ResourceWeekCell {
  readonly resourceId: string;
  readonly resourceName: string;
  /** Thứ Hai của tuần, dạng YYYY-MM-DD. */
  readonly weekStart: string;
  readonly md: number;
}

/** Dữ liệu thô cho bản `resource` (§11.1): ai làm bao nhiêu MD trong tuần nào. */
export function loadAssignmentSpans(
  db: Db,
  projectId: string,
): Array<{
  resourceId: string;
  resourceName: string;
  from: string;
  to: string;
  allocation: number;
}> {
  const rows = db
    .prepare(
      `SELECT a.resource_id, r.name, a.from_date, a.to_date, a.allocation
       FROM assignment a
       JOIN task t     ON t.uid = a.task_uid
       JOIN resource r ON r.id = a.resource_id
       WHERE t.project_id = ?
       ORDER BY a.resource_id, a.from_date, a.task_uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    resourceName: r['name'] as string,
    from: r['from_date'] as string,
    to: r['to_date'] as string,
    allocation: r['allocation'] as number,
  }));
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

// ── EVM: ghép baseline với tiến độ hiện tại ─────────────────────────────────

export interface EvmReport extends EvmResult {
  readonly baselineId: string;
  readonly baselineLabel: string;
  readonly statusDate: string;
}

/**
 * Tính SPI cho một dự án so với một baseline.
 *
 * Không truyền `baselineId` thì lấy baseline **mới nhất**. §7.13 nói `Plan v1.0` là mốc
 * cam kết, nên muốn đo scope creep so với cam kết gốc thì phải chỉ đích danh nó.
 *
 * Trả `null` khi dự án chưa chốt baseline nào — EVM không có nghĩa nếu chưa có kế hoạch
 * gốc để so.
 */
export function loadEvm(db: Db, projectId: string, baselineId?: string): EvmReport | null {
  const baselines = listBaselines(db, projectId);
  const chosen =
    baselineId === undefined ? baselines[0] : baselines.find((b) => b.id === baselineId);
  if (chosen === undefined) return null;

  const project = db
    .prepare('SELECT status_date, calendar_id FROM project WHERE id = ?')
    .get(projectId) as { status_date: string; calendar_id: string } | undefined;
  if (project === undefined) throw new Error(`Unknown project: ${projectId}`);

  const snapshot = new Map(readBaselineSnapshot(db, chosen.id).map((r) => [r.uid, r]));

  // Trạng thái HIỆN TẠI của task lá. Summary bị loại: gộp chúng vào sẽ đếm hai lần.
  const current = db
    .prepare(
      `SELECT t.uid, t.effort_md,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent
       FROM task t
       LEFT JOIN progress p ON p.task_uid = t.uid
       WHERE t.project_id = ? AND t.kind != 'summary'`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const calendar = createCalendarEngine(loadCalendarSnapshot(db));
  const statusDate = project.status_date;

  const tasks: EvmTask[] = [];
  let outside = 0;

  for (const row of current) {
    const uid = row['uid'] as string;
    const base = snapshot.get(uid);

    if (base === undefined) {
      // Thêm vào sau khi chốt baseline — không tính vào BCWS/BCWP, báo riêng.
      outside += (row['effort_md'] as number | null) ?? 0;
      continue;
    }

    const start = base.startDate;
    const elapsed =
      start !== null && start <= statusDate
        ? calendar.workingDaysBetween(
            project.calendar_id,
            unsafeDateOnly(start),
            unsafeDateOnly(statusDate),
          )
        : 0;
    const duration =
      start !== null && base.endDate !== null
        ? calendar.workingDaysBetween(
            project.calendar_id,
            unsafeDateOnly(start),
            unsafeDateOnly(base.endDate),
          ) + 1
        : 0;

    tasks.push({
      uid,
      baselineMd: base.effortMd,
      baselineDurationDays: duration,
      elapsedWorkingDays: elapsed,
      currentPercent: row['percent'] as number,
      currentStatus: row['status'] as ProgressStatus,
    });
  }

  return {
    ...computeEvm(tasks, outside),
    baselineId: chosen.id,
    baselineLabel: chosen.label,
    statusDate,
  };
}
