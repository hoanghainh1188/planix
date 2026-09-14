/**
 * Đọc dữ liệu cho scheduler và ghi kết quả — SPEC.md §3.1, §4.3.
 *
 * §4.3: `schedule` và `assignment` bị **xoá sạch và tính lại từ đầu** mỗi lần chạy
 * engine. Không update từng dòng. Đây là điều kiện của M2 — update từng dòng sẽ để lại
 * dòng cũ của lần chạy trước khi cây task đổi, và kết quả thôi tái lập được.
 *
 * §3.1: scheduler chạy trong RAM, chỉ ghi xuống DB trong một transaction NGẮN ở cuối,
 * giữ write lock dưới 200 ms.
 */

import type { Db } from '../migrate.js';
import type { DepTask } from '../../domain/dependency.js';
import type { SgsAssignment, SgsScheduleRow } from '../../domain/sgs.js';
import type { DateOnly } from '../../domain/date-only.js';

export interface ProjectSettings {
  readonly id: string;
  readonly code: string;
  readonly startDate: DateOnly;
  readonly statusDate: DateOnly;
  readonly calendarId: string;
  readonly defaultLocation: string;
  readonly defaultMaxParallel: number;
  readonly minAllocation: number;
  readonly dependencyMaxLevel: number;
  readonly microTaskThreshold: number;
}

export function loadProjectSettings(db: Db, projectId: string): ProjectSettings | undefined {
  const r = db
    .prepare(
      `SELECT id, code, start_date, status_date, calendar_id, default_location,
              default_max_parallel, min_allocation, dependency_max_level, micro_task_threshold
       FROM project WHERE id = ?`,
    )
    .get(projectId) as Record<string, unknown> | undefined;
  if (r === undefined) return undefined;
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    startDate: r['start_date'] as DateOnly,
    statusDate: r['status_date'] as DateOnly,
    calendarId: r['calendar_id'] as string,
    defaultLocation: r['default_location'] as string,
    defaultMaxParallel: r['default_max_parallel'] as number,
    minAllocation: r['min_allocation'] as number,
    dependencyMaxLevel: r['dependency_max_level'] as number,
    microTaskThreshold: r['micro_task_threshold'] as number,
  };
}

/** Lịch B của dự án: §6.1 chốt lag luôn cộng theo lịch của `default_location`. */
export function loadLagCalendarId(db: Db, defaultLocation: string): string {
  const r = db.prepare('SELECT calendar_id FROM location WHERE id = ?').get(defaultLocation) as
    { calendar_id: string } | undefined;
  if (r === undefined) throw new Error(`Unknown location: ${defaultLocation}`);
  return r.calendar_id;
}

/** Task kèm status từ `progress` — task chưa có dòng progress coi như `not_started`. */
export function loadDepTasks(db: Db, projectId: string): DepTask[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.parent_uid, t.sort_order, t.depth, t.kind, t.child_sequencing,
              COALESCE(p.status, 'not_started') AS status
       FROM task t
       LEFT JOIN progress p ON p.task_uid = t.uid
       WHERE t.project_id = ?
       ORDER BY t.uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    uid: r['uid'] as string,
    parentUid: (r['parent_uid'] as string | null) ?? null,
    sortOrder: r['sort_order'] as number,
    depth: r['depth'] as number,
    kind: r['kind'] as DepTask['kind'],
    childSequencing: (r['child_sequencing'] as DepTask['childSequencing']) ?? null,
    status: r['status'] as DepTask['status'],
  }));
}

export interface ResourceCapability {
  readonly resourceId: string;
  readonly role: string;
  readonly proficiency: number;
  readonly maxParallel: number | null;
}

export function loadResourceCapabilities(db: Db): ResourceCapability[] {
  const rows = db
    .prepare(
      `SELECT rr.resource_id, rr.role, rr.proficiency, r.max_parallel
       FROM resource_role rr JOIN resource r ON r.id = rr.resource_id
       ORDER BY rr.resource_id, rr.role`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    role: r['role'] as string,
    proficiency: r['proficiency'] as number,
    maxParallel: (r['max_parallel'] as number | null) ?? null,
  }));
}

export interface SchedulingFacts {
  readonly uid: string;
  readonly wbsCode: string;
  readonly kind: 'summary' | 'work' | 'milestone';
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly priority: number;
  readonly pinnedResource: string | null;
  readonly constraintType: 'ASAP' | 'SNET' | 'FNLT' | 'MSO' | null;
  readonly constraintDate: DateOnly | null;
  readonly status: string;
  readonly percent: number;
  readonly remainingMd: number | null;
  readonly actualStart: DateOnly | null;
  readonly actualEnd: DateOnly | null;
}

export function loadSchedulingFacts(db: Db, projectId: string): SchedulingFacts[] {
  const rows = db
    .prepare(
      `SELECT t.uid, t.wbs_code, t.kind, t.effort_md, t.role, t.priority,
              t.pinned_resource, t.constraint_type, t.constraint_date,
              COALESCE(p.status,'not_started') AS status,
              COALESCE(p.percent,0) AS percent,
              p.remaining_md, p.actual_start, p.actual_end
       FROM task t
       LEFT JOIN progress p ON p.task_uid = t.uid
       WHERE t.project_id = ?
       ORDER BY t.uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    uid: r['uid'] as string,
    wbsCode: r['wbs_code'] as string,
    kind: r['kind'] as SchedulingFacts['kind'],
    effortMd: (r['effort_md'] as number | null) ?? null,
    role: (r['role'] as string | null) ?? null,
    priority: r['priority'] as number,
    pinnedResource: (r['pinned_resource'] as string | null) ?? null,
    constraintType: (r['constraint_type'] as SchedulingFacts['constraintType']) ?? null,
    constraintDate: (r['constraint_date'] as DateOnly | null) ?? null,
    status: r['status'] as string,
    percent: r['percent'] as number,
    remainingMd: (r['remaining_md'] as number | null) ?? null,
    actualStart: (r['actual_start'] as DateOnly | null) ?? null,
    actualEnd: (r['actual_end'] as DateOnly | null) ?? null,
  }));
}

export interface CpmRowForWrite {
  readonly es: DateOnly;
  readonly ef: DateOnly;
  readonly ls: DateOnly;
  readonly lf: DateOnly;
  readonly totalFloat: number;
  readonly isCritical: boolean;
}

export interface WritePayload {
  readonly projectId: string;
  readonly computedAt: string;
  readonly cpm: ReadonlyMap<string, CpmRowForWrite>;
  readonly schedule: ReadonlyMap<string, SgsScheduleRow>;
  readonly assignments: readonly SgsAssignment[];
  /**
   * Task nằm trên đường găng SAU khi san tài nguyên (§7 pha C, bước C1).
   *
   * Trước đây cột `is_resource_critical` bị ghi cứng `0`, nên `wbs_get_critical_path`
   * mode `resource` luôn trả rỗng. Xem
   * `docs/decisions/2026-09-13-resource-critical-path-chua-co.md`.
   */
  readonly resourceCritical: ReadonlySet<string>;
  /**
   * Task chỉ rời khỏi đường găng chặt vì LỆCH LỊCH, không vì có chỗ trống thật (§5 của
   * quyết định 2026-09-13). Rời nhau với `resourceCritical`.
   */
  readonly resourceNearCritical: ReadonlySet<string>;
}

/**
 * Ghi kết quả engine. Xoá sạch rồi chèn lại, trong MỘT transaction (§4.3, §3.1).
 *
 * Trả về thời gian giữ write lock để gọi bên ngoài kiểm được ngưỡng 200 ms của §3.1.
 */
export function writeScheduleResults(db: Db, payload: WritePayload): { writeLockMs: number } {
  const delSchedule = db.prepare(
    `DELETE FROM schedule WHERE task_uid IN (SELECT uid FROM task WHERE project_id = ?)`,
  );
  const delAssignment = db.prepare(
    `DELETE FROM assignment WHERE task_uid IN (SELECT uid FROM task WHERE project_id = ?)`,
  );
  const insSchedule = db.prepare(
    `INSERT INTO schedule
       (task_uid, es, ef, ls, lf, total_float, free_float, is_critical,
        start_date, end_date, duration_days, is_resource_critical,
        is_resource_near_critical, delay_reason, blocking_ref, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insAssignment = db.prepare(
    `INSERT INTO assignment (task_uid, resource_id, allocation, from_date, to_date, is_pinned)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const started = performance.now();
  db.transaction(() => {
    delSchedule.run(payload.projectId);
    delAssignment.run(payload.projectId);

    // Duyệt theo uid đã sắp: thứ tự chèn ảnh hưởng rowid, và rowid lọt vào mọi truy vấn
    // không có ORDER BY tường minh. Giữ nó cố định để kết quả tái lập (M2).
    for (const uid of [...payload.schedule.keys()].sort()) {
      const s = payload.schedule.get(uid);
      if (s === undefined) continue;
      const c = payload.cpm.get(uid);
      insSchedule.run(
        uid,
        c?.es ?? null,
        c?.ef ?? null,
        c?.ls ?? null,
        c?.lf ?? null,
        c?.totalFloat ?? null,
        c?.isCritical === true ? 1 : 0,
        s.startDate,
        s.endDate,
        s.durationDays,
        payload.resourceCritical.has(uid) ? 1 : 0,
        payload.resourceNearCritical.has(uid) ? 1 : 0,
        s.delayReason,
        s.blockingRef,
        payload.computedAt,
      );
    }

    for (const a of [...payload.assignments].sort((x, y) =>
      x.taskUid < y.taskUid ? -1 : x.taskUid > y.taskUid ? 1 : 0,
    )) {
      insAssignment.run(
        a.taskUid,
        a.resourceId,
        a.allocation,
        a.fromDate,
        a.toDate,
        a.isPinned ? 1 : 0,
      );
    }
  })();

  return { writeLockMs: performance.now() - started };
}

/**
 * Dự án tham gia lập lịch, theo đúng thứ tự §7.12.
 *
 * Chỉ `planning` và `active`: dự án `onhold` hoặc `closed` không được chiếm nhân sự.
 * Trùng `priority` thì tie-break theo `code` tăng dần — bậc chốt, vì `code` là UNIQUE.
 */
export function loadSchedulableProjects(
  db: Db,
): Array<{ id: string; code: string; priority: number }> {
  return db
    .prepare(
      `SELECT id, code, priority FROM project
       WHERE status IN ('planning','active')
       ORDER BY priority ASC, code ASC`,
    )
    .all() as Array<{ id: string; code: string; priority: number }>;
}

export interface ExternalAssignmentRow {
  readonly resourceId: string;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  readonly allocation: number;
  readonly projectId: string;
}

/**
 * Assignment của MỌI dự án khác — pool nhân sự là toàn cục (§7.12).
 *
 * Dự án `onhold` / `closed` vẫn được tính: người của họ đã bị giữ chỗ trên thực tế, và
 * bỏ qua sẽ khiến engine hứa một người đang bận ở nơi khác.
 */
export function loadExternalAssignments(db: Db, excludeProjectId: string): ExternalAssignmentRow[] {
  const rows = db
    .prepare(
      `SELECT a.resource_id, a.from_date, a.to_date, a.allocation, t.project_id
       FROM assignment a JOIN task t ON t.uid = a.task_uid
       WHERE t.project_id != ?
       ORDER BY a.resource_id, a.from_date, t.project_id, a.task_uid`,
    )
    .all(excludeProjectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    resourceId: r['resource_id'] as string,
    fromDate: r['from_date'] as DateOnly,
    toDate: r['to_date'] as DateOnly,
    allocation: r['allocation'] as number,
    projectId: r['project_id'] as string,
  }));
}

/**
 * Người đang làm các task `in_progress`, đọc TRƯỚC khi xoá bảng `assignment`.
 *
 * §7.12 nói "việc đang chạy không bị dời". Nhưng §4.3 lại xoá sạch `assignment` mỗi lần
 * chạy engine, trong khi thông tin "ai đang làm task này" chỉ nằm ở đúng bảng đó — một
 * vòng luẩn quẩn trong spec. Cách thoát: đọc ra trước khi xoá, rồi ghim lại người cũ.
 *
 * Không ghim thì mỗi lần recalculate, một người đang làm dở có thể bị thay bằng người
 * khác chỉ vì RESOURCE_KEY thấy người kia rảnh hơn — và PM sẽ thấy nhân sự nhảy loạn
 * giữa các tuần mà không hiểu vì sao.
 */
export function loadRunningAssignees(db: Db, projectId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT a.task_uid, a.resource_id
       FROM assignment a
       JOIN task t ON t.uid = a.task_uid
       JOIN progress p ON p.task_uid = a.task_uid
       WHERE t.project_id = ? AND p.status IN ('in_progress','blocked')
       ORDER BY a.task_uid`,
    )
    .all(projectId) as Array<{ task_uid: string; resource_id: string }>;
  return new Map(rows.map((r) => [r.task_uid, r.resource_id]));
}

export interface TaskLocation {
  readonly uid: string;
  readonly locationId: string | null;
}

/**
 * Nơi làm việc của từng task, cho `J08`.
 *
 * §5.4: *"Milestone có `location_id` → không được rơi vào ngày nghỉ của location đó"*, và
 * schema ghi `NULL = derive from assignee`. Nên thứ tự tra là: location của chính task →
 * location của người được gán → (người gọi tự lùi về `default_location` của dự án).
 *
 * Trả `null` khi không suy ra được, thay vì tự điền mặc định ở đây: chỗ biết
 * `default_location` là pipeline, và giấu một bước lùi mặc định trong câu SQL sẽ khiến
 * `J08` im lặng báo theo lịch sai mà không ai thấy.
 */
export function loadTaskLocations(db: Db, projectId: string): TaskLocation[] {
  const rows = db
    .prepare(
      `SELECT t.uid,
              COALESCE(t.location_id, (
                SELECT r.location_id FROM assignment a
                  JOIN resource r ON r.id = a.resource_id
                 WHERE a.task_uid = t.uid
                 ORDER BY a.resource_id LIMIT 1
              )) AS location_id
         FROM task t
        WHERE t.project_id = ?
        ORDER BY t.uid`,
    )
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    uid: r['uid'] as string,
    locationId: (r['location_id'] as string | null) ?? null,
  }));
}

export interface GlobalAssignment {
  readonly taskUid: string;
  readonly resourceId: string;
  readonly allocation: number;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  /** `J06` đo tải bằng khối lượng thật, không bằng `allocation` — xem `spreadOf`. */
  readonly effortMd: number;
}

/**
 * Assignment của MỌI dự án chồng lên một khoảng — đầu vào cho `J06`.
 *
 * Cố ý KHÔNG lọc theo `project_id`. §7.12 cho hai dự án dùng chung người, nên tỷ lệ sử
 * dụng chỉ có nghĩa khi nhìn toàn cục: lọc theo dự án sẽ biến một người bận kín ở nơi
 * khác thành "rảnh 0%". Xem docs/decisions/2026-09-13-j06-pool-chung.md.
 */
export function loadAssignmentsInWindow(db: Db, from: DateOnly, to: DateOnly): GlobalAssignment[] {
  const rows = db
    .prepare(
      `SELECT a.task_uid, a.resource_id, a.allocation, a.from_date, a.to_date,
              COALESCE(t.effort_md, 0) AS effort_md
         FROM assignment a
         JOIN task t ON t.uid = a.task_uid
        WHERE a.from_date <= ? AND a.to_date >= ?
        ORDER BY a.resource_id, a.task_uid`,
    )
    .all(to, from) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    taskUid: r['task_uid'] as string,
    resourceId: r['resource_id'] as string,
    allocation: r['allocation'] as number,
    fromDate: r['from_date'] as DateOnly,
    toDate: r['to_date'] as DateOnly,
    effortMd: r['effort_md'] as number,
  }));
}
