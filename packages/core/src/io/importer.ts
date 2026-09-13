/**
 * Importer AI → Tool, SPEC.md §9.3.
 *
 * Sáu bước, đúng thứ tự spec:
 *   1. validate schema bằng zod — sai một trường là từ chối CẢ FILE
 *   2. cấp uid thật cho từng tmp_id theo thứ tự xuất hiện
 *   3. dịch dependencies từ tmp_id sang uid
 *   4. renumber → sinh wbs_code và depth
 *   5. validate — có Critical thì rollback toàn bộ transaction
 *   6. trả về số task thêm, bảng ánh xạ, ValidationReport
 *
 * N1: đây là cửa DUY NHẤT để AI ghi vào DB, và cửa này không bao giờ chạm
 * `schedule` hay `assignment`.
 */

import { renumber, type TaskNode } from '../domain/renumber.js';
import { validate } from '../domain/validator.js';
import { recordValidationRun } from '../db/repo/issue-repo.js';
import type { ValidationReport } from '../domain/validation-types.js';
import type { Db } from '../db/migrate.js';
import * as repo from '../db/repo/import-repo.js';
import { ImportPayloadSchema } from './import-schema.js';

/** Khoá nhóm anh em cấp gốc. Không phải uid hợp lệ nên không đụng khoá thật. */
const ROOT_BUCKET = '<root>';

export interface ImportOptions {
  readonly runId: string;
  /** Thời điểm ghi created_at / updated_at. Truyền từ ngoài — core không đọc đồng hồ (N2). */
  readonly now: string;
}

export interface ImportResult {
  readonly tasksAdded: number;
  /** tmp_id thành uid thật (§9.3 bước 2). */
  readonly mapping: Readonly<Record<string, string>>;
  readonly report: ValidationReport;
}

/** Ném khi validate phát hiện Critical — mang theo báo cáo để người gọi hiển thị. */
export class ImportValidationError extends Error {
  // Gán tường minh thay vì parameter property: `constructor(readonly x)` cần sinh code,
  // nên công cụ chỉ xoá kiểu (node --strip-types, esbuild) không chạy được file này.
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    const codes = [
      ...new Set(report.issues.filter((i) => i.severity === 'Critical').map((i) => i.code)),
    ].sort();
    super(`Import rejected: ${codes.join(', ')}`);
    this.name = 'ImportValidationError';
    this.report = report;
  }
}

function formatUid(sequence: number): string {
  return `T-${String(sequence).padStart(4, '0')}`;
}

export function importTasks(db: Db, payload: unknown, options: ImportOptions): ImportResult {
  // Bước 1 — sai một trường là từ chối cả file, không import một phần (§9.3).
  const parsed = ImportPayloadSchema.parse(payload);

  const project = repo.findProjectByCode(db, parsed.project_code);
  if (project === undefined) {
    throw new Error(`Unknown project_code: ${parsed.project_code}`);
  }

  const run = db.transaction((): ImportResult => {
    if (parsed.mode === 'replace-subtree') {
      const rootUid = parsed.root_uid;
      if (rootUid === undefined) {
        throw new Error('root_uid is required when mode is "replace-subtree"');
      }
      if (!repo.taskExists(db, rootUid)) {
        throw new Error(`Unknown root_uid: ${rootUid}`);
      }
      repo.deleteSubtree(db, rootUid);
    }

    // Bước 2 — uid cấp theo thứ tự xuất hiện trong file. Cùng file trên cùng DB
    // cho cùng uid (M2).
    let sequence = repo.maxTaskSequence(db);
    const mapping: Record<string, string> = {};
    for (const t of parsed.tasks) {
      if (mapping[t.tmp_id] !== undefined) {
        throw new Error(`Duplicate tmp_id in payload: ${t.tmp_id}`);
      }
      sequence++;
      mapping[t.tmp_id] = formatUid(sequence);
    }

    // sort_order theo thứ tự xuất hiện trong nhóm anh em.
    const nextSortOrder = new Map<string, number>();

    for (const t of parsed.tasks) {
      const uid = mapping[t.tmp_id];
      if (uid === undefined) throw new Error(`Unmapped tmp_id: ${t.tmp_id}`);

      let parentUid: string | null = null;
      if (t.parent_tmp_id !== null && t.parent_tmp_id !== undefined) {
        const mapped = mapping[t.parent_tmp_id];
        if (mapped === undefined) {
          throw new Error(`parent_tmp_id ${t.parent_tmp_id} is not declared in this file`);
        }
        parentUid = mapped;
      } else if (t.parent_uid !== null && t.parent_uid !== undefined) {
        if (!repo.taskExists(db, t.parent_uid)) {
          throw new Error(`parent_uid ${t.parent_uid} does not exist`);
        }
        parentUid = t.parent_uid;
      }

      const key = parentUid ?? ROOT_BUCKET;
      const order = (nextSortOrder.get(key) ?? 0) + 1;
      nextSortOrder.set(key, order);

      repo.insertTask(db, {
        uid,
        projectId: project.id,
        parentUid,
        sortOrder: order,
        name: t.name,
        kind: t.kind,
        effortMd: t.effort_md ?? null,
        role: t.role ?? null,
        category: t.category ?? null,
        phase: t.phase ?? null,
        module: t.module ?? null,
        priority: t.priority ?? 500,
        childSequencing: t.child_sequencing ?? null,
        now: options.now,
      });
    }

    // Bước 3 — dịch dependency. pred/succ có thể là tmp_id trong file này, hoặc uid
    // của task đã có trong DB khi gắn vào cây sẵn có.
    for (const d of parsed.dependencies) {
      const predUid = mapping[d.pred] ?? (repo.taskExists(db, d.pred) ? d.pred : undefined);
      const succUid = mapping[d.succ] ?? (repo.taskExists(db, d.succ) ? d.succ : undefined);
      if (predUid === undefined) {
        throw new Error(
          `Dependency pred "${d.pred}" is neither a tmp_id in this file nor an existing uid`,
        );
      }
      if (succUid === undefined) {
        throw new Error(
          `Dependency succ "${d.succ}" is neither a tmp_id in this file nor an existing uid`,
        );
      }
      repo.insertDependency(db, predUid, succUid, d.type, d.lag_days);
    }

    // Bước 4 — renumber cả cây của dự án, không chỉ phần mới thêm: chèn một nhánh
    // làm đổi mã của mọi nhánh sau nó.
    const nodes: TaskNode[] = repo.loadTasks(db, project.id).map((t) => ({
      uid: t.uid,
      parentUid: t.parentUid,
      sortOrder: t.sortOrder,
    }));
    for (const r of renumber(nodes)) {
      repo.updateWbs(db, r.uid, r.wbsCode, r.depth);
    }

    // Bước 5 — validate trên trạng thái SAU khi ghi. Có Critical thì ném; đang trong
    // transaction nên toàn bộ rollback, DB không đổi (§9.3).
    const report = validate({
      runId: options.runId,
      projectId: project.id,
      tasks: repo.loadTasks(db, project.id),
      dependencies: repo.loadDependencies(db, project.id),
      resources: repo.loadResources(db),
      resourceRoles: repo.loadResourceRoles(db),
      progress: repo.loadProgress(db, project.id),
      dependencyMaxLevel: project.dependencyMaxLevel,
    });

    if (!report.passed) {
      throw new ImportValidationError(report);
    }

    // §8 "chạy sau mỗi lần import". Ghi TRONG transaction, cùng số phận với dữ liệu vừa
    // nạp: import hỏng thì cả hai cùng biến mất. Không ghi ở nhánh Critical phía trên là
    // có chủ ý — task vừa nạp bị rollback, nên issue trỏ vào uid của chúng sẽ là rác trỏ
    // vào hư không. Người gọi vẫn nhận đủ report qua `ImportValidationError`.
    recordValidationRun(db, {
      runId: options.runId,
      projectId: project.id,
      detectedAt: options.now,
      source: 'import',
      issues: report.issues,
    });

    return { tasksAdded: parsed.tasks.length, mapping, report };
  });

  return run();
}
