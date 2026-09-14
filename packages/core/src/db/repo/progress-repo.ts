/**
 * Tiến độ — S4 nhập tiến độ (§10.5) và bảng của lead.
 *
 * Tách ra từ `read-repo.ts` (xem chú thích ở `wbs-repo.ts`).
 */

/**
 * Read model cho các màn hình — SPEC.md §10.3.
 *
 * §10.1: "Mọi số hiển thị đọc từ `schedule` / `assignment`. Không tính lại ở client."
 * Vì vậy các hàm ở đây trả về đúng thứ UI hiện, đã gộp sẵn, không để client tự ghép.
 */

import type { Db } from '../migrate.js';
import { isMicroTask } from '../../domain/rollup.js';
import { createCalendarEngine } from '../../domain/calendar.js';
import { unsafeDateOnly } from '../../domain/date-only.js';
import { suggestProgress, type Suggestion } from '../../domain/progress-suggest.js';
import { loadCalendarSnapshot } from './calendar-repo.js';
import type { TaskKind } from '../../domain/validation-types.js';

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
