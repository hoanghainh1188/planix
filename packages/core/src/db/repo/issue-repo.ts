/**
 * Lưu kết quả validate xuống `validation_issue` — SPEC.md §8, màn S6.
 *
 * §8 nói validate "chạy sau mỗi lần import, mỗi lần schedule, mỗi lần lưu progress".
 * Nó vẫn chạy đủ ba chỗ, nhưng kết quả trước nay chỉ được trả về cho người gọi rồi bị
 * vứt đi — không đường nào ghi xuống. Panel Issues (S6) và chấm đỏ §10.4 đọc từ bảng
 * này, nên cả hai luôn trống bất kể dự án hỏng tới đâu.
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3); prepared statement, không nối chuỗi.
 */

import type { Db } from '../migrate.js';
import type { Severity } from '../../domain/validation-types.js';

/**
 * Một dòng đủ để ghi xuống.
 *
 * Cố ý KHỚP với cả `ValidationIssue` (§8.4) lẫn `ScheduleIssue` của pipeline: hai nguồn
 * sinh issue khác nhau nhưng cùng đổ về một bảng, vì với PM đọc màn S6 thì "vòng lặp phụ
 * thuộc" và "người bị overallocate" đều là vấn đề của dự án, không phải hai loại dữ liệu.
 */
export interface RecordedIssue {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly taskUid?: string | undefined;
  readonly detail?: Readonly<Record<string, unknown>> | undefined;
}

export interface RecordValidationRunParams {
  readonly runId: string;
  readonly projectId: string;
  readonly detectedAt: string;
  readonly issues: readonly RecordedIssue[];
}

/**
 * Ghi kết quả một lượt validate, THAY cho kết quả lượt trước của cùng dự án.
 *
 * Vì sao thay chứ không cộng dồn — hai lý do:
 *
 * 1. Người đọc duy nhất (`loadIssues`, `loadWbsTree`) đều chỉ lấy run MỚI NHẤT. Giữ lại
 *    run cũ là giữ dữ liệu không ai đọc.
 * 2. Số issue tỷ lệ với số task: một dự án 6.000 task thiếu `role` sinh 6.000 dòng C04
 *    mỗi lượt. Cộng dồn qua từng lần bấm Recalculate thì bảng phình vô hạn.
 *
 * Spec không nói gì về việc giữ lịch sử issue, và không màn nào hiện nó. Vết ai-sửa-gì
 * vẫn nằm ở `audit_log`. Xem docs/decisions/2026-09-13-luu-ket-qua-validate.md — chỗ này
 * PM cần xác nhận nếu sau này muốn xem issue xuất hiện từ bao giờ.
 *
 * Xoá và ghi nằm trong MỘT transaction: nửa vời ở đây nghĩa là panel hiện lẫn lộn issue
 * của hai lượt khác nhau, mà nhìn bằng mắt thì không phân biệt được.
 */
export function recordValidationRun(db: Db, params: RecordValidationRunParams): number {
  const remove = db.prepare('DELETE FROM validation_issue WHERE project_id = ?');
  const insert = db.prepare(
    `INSERT INTO validation_issue
       (run_id, project_id, severity, code, task_uid, message, detail_json, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Ghi cả LƯỢT chạy, không chỉ issue của nó: không dòng issue nào có thể mang nghĩa
  // "đã kiểm, sạch" — nó trùng hệt với "chưa ai kiểm". Xem migration 004.
  const stampRun = db.prepare(
    `INSERT INTO validation_run (project_id, run_id, ran_at, critical, major, minor)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       run_id = excluded.run_id, ran_at = excluded.ran_at,
       critical = excluded.critical, major = excluded.major, minor = excluded.minor`,
  );

  return db.transaction((): number => {
    remove.run(params.projectId);
    let critical = 0;
    let major = 0;
    let minor = 0;
    for (const issue of params.issues) {
      insert.run(
        params.runId,
        params.projectId,
        issue.severity,
        issue.code,
        issue.taskUid ?? null,
        issue.message,
        issue.detail === undefined ? null : JSON.stringify(issue.detail),
        params.detectedAt,
      );
      if (issue.severity === 'Critical') critical++;
      else if (issue.severity === 'Major') major++;
      else minor++;
    }
    stampRun.run(params.projectId, params.runId, params.detectedAt, critical, major, minor);
    return params.issues.length;
  })();
}

export interface ValidationRunSummary {
  readonly runId: string;
  readonly ranAt: string;
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
}

/**
 * Lượt validate gần nhất của một dự án, `null` nếu chưa từng chạy lần nào.
 *
 * `null` KHÁC với "chạy rồi, không có vấn đề gì". Màn S6 phải nói ra sự khác biệt đó:
 * một bên là "sạch", một bên là "chưa biết".
 */
export function loadLastValidationRun(db: Db, projectId: string): ValidationRunSummary | null {
  const row = db
    .prepare(
      'SELECT run_id, ran_at, critical, major, minor FROM validation_run WHERE project_id = ?',
    )
    .get(projectId) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    runId: row['run_id'] as string,
    ranAt: row['ran_at'] as string,
    critical: row['critical'] as number,
    major: row['major'] as number,
    minor: row['minor'] as number,
  };
}

/** Dự án nào đã có một lượt validate được ghi lại. */
export function listValidatedProjects(db: Db): string[] {
  const rows = db
    .prepare('SELECT project_id FROM validation_run ORDER BY project_id')
    .all() as Array<{ project_id: string }>;
  return rows.map((r) => r.project_id);
}

/**
 * Đọc lại issue của một dự án ở đúng hình dạng để ghi sang DB khác.
 *
 * Khác `loadIssues` (dành cho màn hình, bỏ `detail_json`): ở đây giữ nguyên `detail`, vì
 * mất nó là mất đường đi của C01 — thứ §8.1 đòi.
 */
export function loadRecordedIssues(db: Db, projectId: string): RecordedIssue[] {
  const rows = db
    .prepare(
      `SELECT severity, code, task_uid, message, detail_json
       FROM validation_issue WHERE project_id = ? ORDER BY id`,
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const taskUid = (r['task_uid'] as string | null) ?? undefined;
    const raw = r['detail_json'] as string | null;
    return {
      severity: r['severity'] as Severity,
      code: r['code'] as string,
      message: r['message'] as string,
      taskUid,
      detail: raw === null ? undefined : (JSON.parse(raw) as Record<string, unknown>),
    };
  });
}
