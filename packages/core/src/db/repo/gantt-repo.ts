/**
 * Dòng cho Gantt (§10.3 S3) và ảnh chụp lịch cho bảng so sánh trước/sau (§10.1).
 *
 * Hai thứ cùng một bản chất: đọc `schedule` ra để VẼ, không để tính.
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
import { rollupTree, type RollupTask } from '../../domain/rollup.js';
import type { ProgressStatus, TaskKind } from '../../domain/validation-types.js';

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
