/** Kiểu dùng chung cho UI. Khớp read model của `core/db/repo/read-repo.ts`. */

export interface WbsRow {
  readonly uid: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly parentUid: string | null;
  readonly name: string;
  readonly kind: 'summary' | 'work' | 'milestone';
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly childSequencing: 'parallel' | 'sequential' | null;
  readonly pic: string | null;
  readonly status: string;
  readonly percent: number;
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly totalFloat: number | null;
  readonly isCritical: boolean;
  readonly delayReason: string | null;
  readonly issueCodes: readonly string[];
}

export interface ProjectSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
}

export interface IssueRow {
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly code: string;
  readonly taskUid: string | null;
  readonly message: string;
}
