/**
 * Hợp đồng đầu ra của validate — SPEC.md §8.4.
 *
 * `message` luôn tiếng Anh (§8.4, CLAUDE.md §3). Người đọc cuối là PM Nhật và
 * stakeholder; bản dịch là việc của lớp hiển thị, không phải của engine.
 */

export type Severity = 'Critical' | 'Major' | 'Minor';

export interface ValidationIssue {
  readonly severity: Severity;
  readonly code: string;
  readonly taskUid?: string;
  readonly wbsCode?: string;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ValidationReport {
  readonly runId: string;
  readonly projectId: string;
  /** false nếu có BẤT KỲ Critical nào (§8.4). */
  readonly passed: boolean;
  readonly counts: {
    readonly critical: number;
    readonly major: number;
    readonly minor: number;
  };
  readonly issues: readonly ValidationIssue[];
}

// ── Dữ liệu đầu vào: ảnh chụp thuần, không phải kết nối DB ───────────────────
// Validator là hàm thuần (CLAUDE.md §3). Repo layer lo việc đọc.

export type TaskKind = 'summary' | 'work' | 'milestone';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ConstraintType = 'ASAP' | 'SNET' | 'FNLT' | 'MSO';
export type ProgressStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export interface TaskRow {
  readonly uid: string;
  readonly projectId: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly sortOrder: number;
  readonly name: string;
  readonly kind: TaskKind;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly constraintType: ConstraintType | null;
  readonly constraintDate: string | null;
}

export interface DependencyRow {
  readonly predUid: string;
  readonly succUid: string;
  readonly type: DependencyType;
  readonly lagDays: number;
}

/** Pool nhân sự TOÀN CỤC — không lọc theo dự án (§7.12, quyết định 2026-09-12). */
export interface ResourceRow {
  readonly id: string;
  readonly name: string;
  readonly locationId: string | null;
}

export interface ResourceRoleRow {
  readonly resourceId: string;
  readonly role: string;
}

export interface ProgressRow {
  readonly taskUid: string;
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
}

export interface ValidationInput {
  readonly runId: string;
  readonly projectId: string;
  readonly tasks: readonly TaskRow[];
  readonly dependencies: readonly DependencyRow[];
  readonly resources: readonly ResourceRow[];
  readonly resourceRoles: readonly ResourceRoleRow[];
  readonly progress: readonly ProgressRow[];
  /** `project.dependency_max_level`, mặc định 3 (§6.2). */
  readonly dependencyMaxLevel: number;
}
