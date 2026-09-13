/**
 * Lưu kết quả validate và LỊCH SỬ các lượt chạy — SPEC.md §8, màn S6.
 *
 * §8 nói validate "chạy sau mỗi lần import, mỗi lần schedule, mỗi lần lưu progress"; PM
 * quyết ngày 2026-09-13 mở thêm ra mọi thao tác ghi WBS, và giữ lịch sử để trả lời được
 * câu "issue này xuất hiện từ bao giờ".
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3); prepared statement, không nối chuỗi.
 */

import { createHash } from 'node:crypto';
import type { Db } from '../migrate.js';
import type { Severity } from '../../domain/validation-types.js';

/** Lượt validate này do đâu mà có. */
export type ValidationSource = 'import' | 'schedule' | 'progress' | 'edit';

/**
 * Giữ tối đa ngần này lượt cho mỗi dự án.
 *
 * Có chặn trên vì lịch sử là thứ tự nó không dừng. Nhờ khử trùng bằng vân tay, mỗi dòng ở
 * đây là một TRẠNG THÁI issue khác nhau — không phải một lần bấm nút — nên 100 dòng đã là
 * rất nhiều đời sống của một dự án. Muốn đổi thì đổi ở đây, một chỗ.
 */
export const MAX_RUNS_PER_PROJECT = 100;

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
  readonly source: ValidationSource;
  readonly issues: readonly RecordedIssue[];
}

export interface RecordValidationRunResult {
  readonly issueCount: number;
  /** `false` nghĩa là tập issue y hệt lượt trước — chỉ `last_at` được đẩy lên. */
  readonly changed: boolean;
}

/** Ngăn cách trường và ngăn cách dòng khi băm. Ký tự điều khiển nên không đụng nội dung. */
const FIELD_SEP = '\u0000';
const LINE_SEP = '\u0001';

/**
 * Dấu vân của một TẬP issue.
 *
 * Sắp trước khi băm: thứ tự validator trả về không phải là thông tin, và để nguyên thì hai
 * tập giống hệt nhau lại ra hai vân tay khác nhau (N2 — không được phụ thuộc thứ tự duyệt).
 *
 * `message` nằm trong vân tay vì nó chứa con số cụ thể: "trễ 3 ngày" và "trễ 9 ngày" là hai
 * trạng thái khác nhau của cùng một mã lỗi trên cùng một task.
 */
function fingerprintOf(issues: readonly RecordedIssue[]): string {
  const lines = issues
    .map((i) => [i.severity, i.code, i.taskUid ?? '', i.message].join(FIELD_SEP))
    .sort();
  return createHash('sha256').update(lines.join(LINE_SEP)).digest('hex');
}

interface LatestRunRow {
  readonly id: number;
  readonly fingerprint: string;
}

/**
 * Ghi kết quả một lượt validate.
 *
 * Hai đường:
 *
 * - Tập issue **khác** lượt trước → thêm một dòng lịch sử mới, kèm issue của nó.
 * - Tập issue **y hệt** → chỉ đẩy `last_at` của dòng cũ. Không đẻ dòng mới, không ghi lại
 *   issue. PM sửa tên hai mươi task mà vấn đề không đổi thì đó vẫn là MỘT trạng thái; ghi
 *   thành hai mươi dòng thì "lịch sử" chỉ còn là tiếng ồn, và bảng phình theo số lần gõ
 *   phím chứ không theo diễn biến của dự án.
 *
 * Tất cả trong MỘT transaction: nửa vời ở đây nghĩa là panel hiện lẫn lộn issue của hai
 * lượt khác nhau, mà nhìn bằng mắt thì không phân biệt được.
 */
export function recordValidationRun(
  db: Db,
  params: RecordValidationRunParams,
): RecordValidationRunResult {
  const fingerprint = fingerprintOf(params.issues);

  return db.transaction((): RecordValidationRunResult => {
    const latest = db
      .prepare(
        `SELECT id, fingerprint FROM validation_run
         WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(params.projectId) as LatestRunRow | undefined;

    if (latest !== undefined && latest.fingerprint === fingerprint) {
      db.prepare('UPDATE validation_run SET last_at = ? WHERE id = ?').run(
        params.detectedAt,
        latest.id,
      );
      return { issueCount: params.issues.length, changed: false };
    }

    let critical = 0;
    let major = 0;
    let minor = 0;
    for (const issue of params.issues) {
      if (issue.severity === 'Critical') critical++;
      else if (issue.severity === 'Major') major++;
      else minor++;
    }

    // Dòng lượt TRƯỚC, vì issue cần khoá của nó. `run_id` không đủ để phân biệt lượt:
    // hai lượt trong cùng một mili-giây sinh ra cùng một chuỗi.
    const runPk = db
      .prepare(
        `INSERT INTO validation_run
           (project_id, run_id, source, first_at, last_at, fingerprint, critical, major, minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.projectId,
        params.runId,
        params.source,
        params.detectedAt,
        params.detectedAt,
        fingerprint,
        critical,
        major,
        minor,
      ).lastInsertRowid;

    const insertIssue = db.prepare(
      `INSERT INTO validation_issue
         (run_pk, run_id, project_id, severity, code, task_uid, message, detail_json, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const issue of params.issues) {
      insertIssue.run(
        runPk,
        params.runId,
        params.projectId,
        issue.severity,
        issue.code,
        issue.taskUid ?? null,
        issue.message,
        issue.detail === undefined ? null : JSON.stringify(issue.detail),
        params.detectedAt,
      );
    }

    pruneRuns(db, params.projectId);
    return { issueCount: params.issues.length, changed: true };
  })();
}

/**
 * Cắt bớt lịch sử cũ. Issue đi theo nhờ `ON DELETE CASCADE` trên `run_pk`.
 *
 * Có chặn trên vì lịch sử là thứ tự nó không dừng lại.
 */
function pruneRuns(db: Db, projectId: string): void {
  // `LIMIT -1 OFFSET n` = "bỏ qua n dòng đầu, lấy hết phần còn lại" — cú pháp SQLite cho
  // việc này; không có LIMIT thì OFFSET bị bỏ qua.
  db.prepare(
    `DELETE FROM validation_run WHERE id IN (
       SELECT id FROM validation_run
       WHERE project_id = ?
       ORDER BY id DESC
       LIMIT -1 OFFSET ?
     )`,
  ).run(projectId, MAX_RUNS_PER_PROJECT);
}

export interface ValidationRunSummary {
  readonly id: number;
  readonly runId: string;
  /**
   * Thao tác làm tập issue này XUẤT HIỆN — đi cặp với `firstAt`, không phải với `lastAt`.
   *
   * Lượt sau gặp lại đúng tập issue đó chỉ đẩy `lastAt`, giữ nguyên nguồn: ghi đè nó sẽ
   * nói rằng vấn đề sinh ra từ lần sửa gần nhất, trong khi nó đã ở đó từ trước.
   */
  readonly source: ValidationSource;
  /** Tập issue này xuất hiện lần đầu lúc nào. */
  readonly firstAt: string;
  /** Và còn thấy tới lúc nào. Bằng `firstAt` nếu mới chỉ gặp một lần. */
  readonly lastAt: string;
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
}

function toSummary(row: Record<string, unknown>): ValidationRunSummary {
  return {
    id: row['id'] as number,
    runId: row['run_id'] as string,
    source: row['source'] as ValidationSource,
    firstAt: row['first_at'] as string,
    lastAt: row['last_at'] as string,
    critical: row['critical'] as number,
    major: row['major'] as number,
    minor: row['minor'] as number,
  };
}

const RUN_COLUMNS = 'id, run_id, source, first_at, last_at, critical, major, minor';

/**
 * Lượt validate gần nhất, `null` nếu dự án chưa từng chạy lần nào.
 *
 * `null` KHÁC với "chạy rồi, không có vấn đề gì". Màn S6 phải nói ra sự khác biệt đó: một
 * bên là "sạch", một bên là "chưa biết".
 */
export function loadLastValidationRun(db: Db, projectId: string): ValidationRunSummary | null {
  const row = db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM validation_run
       WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId) as Record<string, unknown> | undefined;
  return row === undefined ? null : toSummary(row);
}

/** Lịch sử các lượt, mới nhất trước. */
export function loadValidationHistory(
  db: Db,
  projectId: string,
  limit = MAX_RUNS_PER_PROJECT,
): ValidationRunSummary[] {
  const rows = db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM validation_run
       WHERE project_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(projectId, limit) as Array<Record<string, unknown>>;
  return rows.map(toSummary);
}

/** Dự án nào đã có ít nhất một lượt validate được ghi lại. */
export function listValidatedProjects(db: Db): string[] {
  const rows = db
    .prepare('SELECT DISTINCT project_id FROM validation_run ORDER BY project_id')
    .all() as Array<{ project_id: string }>;
  return rows.map((r) => r.project_id);
}

/**
 * Đọc lại issue của MỘT lượt, ở đúng hình dạng để ghi sang DB khác.
 *
 * Khác `loadIssues` (dành cho màn hình, bỏ `detail_json`): ở đây giữ nguyên `detail`, vì
 * mất nó là mất đường đi của C01 — thứ §8.1 đòi.
 */
export function loadRecordedIssues(db: Db, runPk: number): RecordedIssue[] {
  const rows = db
    .prepare(
      `SELECT severity, code, task_uid, message, detail_json
       FROM validation_issue WHERE run_pk = ? ORDER BY id`,
    )
    .all(runPk) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const raw = r['detail_json'] as string | null;
    return {
      severity: r['severity'] as Severity,
      code: r['code'] as string,
      message: r['message'] as string,
      taskUid: (r['task_uid'] as string | null) ?? undefined,
      detail: raw === null ? undefined : (JSON.parse(raw) as Record<string, unknown>),
    };
  });
}
