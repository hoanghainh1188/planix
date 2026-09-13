/**
 * Xuất Excel — SPEC.md §11. Điểm vào duy nhất cho cả ba bản báo cáo.
 *
 * §11.4 là chốt chặn: engine chạy validate trước, có Critical thì TỪ CHỐI xuất. Lý do
 * nằm ngay trong spec: "Bản summary đi thẳng tới khách Nhật, không được phép chứa mâu
 * thuẫn tổng/chi tiết." Một file sai gửi cho khách không rút lại được.
 */

import type { Db } from '../../db/migrate.js';
import * as read from '../../db/repo/read-repo.js';
import * as importRepo from '../../db/repo/import-repo.js';
import { loadCalendarSnapshot } from '../../db/repo/calendar-repo.js';
import { loadProjectSettings } from '../../db/repo/schedule-repo.js';
import { createCalendarEngine } from '../../domain/calendar.js';
import { validate } from '../../domain/validator.js';
import type { ValidationReport } from '../../domain/validation-types.js';
import { compareWbsCode } from '../../domain/tie-break.js';
import { createWorkbook, toBuffer } from './workbook.js';
import { buildFullSheet } from './full.js';
import { buildSummarySheet, MAX_SUMMARY_DEPTH } from './summary.js';
import { buildMatrix, buildResourceSheet } from './resource.js';

export type ReportKind = 'full' | 'summary' | 'resource';

export interface ExportOptions {
  readonly projectId: string;
  readonly report: ReportKind;
  /** Chỉ dùng cho bản `summary`. §11.3 mặc định 3. */
  readonly depth?: number;
  readonly runId: string;
}

export interface ExportResult {
  readonly buffer: Buffer;
  readonly filename: string;
  /** §11.4: có Major thì vẫn xuất, nhưng kèm danh sách để người xuất biết. */
  readonly warnings: readonly string[];
}

/** §11.4 — Critical thì không xuất. Mang theo báo cáo để lớp trên hiện đúng vấn đề. */
export class ExportBlockedError extends Error {
  readonly report: ValidationReport;
  constructor(report: ValidationReport) {
    super(`Export blocked: ${String(report.counts.critical)} critical issue(s)`);
    this.name = 'ExportBlockedError';
    this.report = report;
  }
}

export async function exportExcel(db: Db, options: ExportOptions): Promise<ExportResult> {
  const settings = loadProjectSettings(db, options.projectId);
  if (settings === undefined) throw new Error(`Unknown project: ${options.projectId}`);

  // §11.4 — chạy validate TƯƠI, không đọc lại kết quả lần chạy engine trước: dữ liệu có
  // thể đã đổi kể từ đó, và đúng cái đổi ấy mới là thứ cần chặn.
  const report = validate({
    runId: options.runId,
    projectId: options.projectId,
    tasks: importRepo.loadTasks(db, options.projectId),
    dependencies: importRepo.loadDependencies(db, options.projectId),
    resources: importRepo.loadResources(db),
    resourceRoles: importRepo.loadResourceRoles(db),
    progress: importRepo.loadProgress(db, options.projectId),
    dependencyMaxLevel: settings.dependencyMaxLevel,
    // Cùng bộ đầu vào với mọi lời gọi validate khác. Thiếu chúng thì `J03`/`J04`/`J11`
    // im lặng ở đúng chỗ cần nói nhất: báo cáo gửi cho khách.
    schedule: importRepo.loadSchedule(db, options.projectId),
    ...importRepo.loadProjectDates(db, options.projectId),
  });
  if (!report.passed) throw new ExportBlockedError(report);

  const warnings = report.issues
    .filter((i) => i.severity === 'Major')
    .map((i) => `${i.code}: ${i.message}`);

  const data = read.loadReportData(db, options.projectId);
  // §11.5: "Sắp xếp cuối cùng luôn theo wbs_code (natural sort)." Dùng đúng hàm mà ba
  // màn hình đang dùng, để báo cáo và giao diện không bao giờ khác thứ tự.
  const rows = [...data.rows].sort((a, b) => compareWbsCode(a.wbsCode, b.wbsCode));

  const wb = createWorkbook();

  if (options.report === 'full') {
    buildFullSheet(wb, rows, data.statusDate);
  } else if (options.report === 'summary') {
    const depth = options.depth ?? MAX_SUMMARY_DEPTH;
    // §11.3 có đúng ba cột phân cấp, nên sâu hơn 3 là không hiện được. Từ chối thẳng còn
    // hơn lặng lẽ dồn cấp 4 vào cột cấp 3 rồi để khách đọc nhầm.
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SUMMARY_DEPTH) {
      throw new Error(
        `depth phải từ 1 tới ${String(MAX_SUMMARY_DEPTH)} — bản summary chỉ có ba cột 大項目/中項目/小項目.`,
      );
    }
    const leaves = rows.filter((r) => r.kind !== 'summary');
    const micro = leaves.filter((r) => r.isMicro).length;
    buildSummarySheet(wb, rows, {
      maxDepth: depth,
      statusDate: data.statusDate,
      // "Phần lớn" = quá nửa số task lá.
      microDominant: leaves.length > 0 && micro * 2 > leaves.length,
    });
  } else {
    const calendar = createCalendarEngine(loadCalendarSnapshot(db));
    const matrix = buildMatrix(
      read.loadAssignmentSpans(db, options.projectId),
      (resourceId, day) => calendar.capacityOn(resourceId, day) > 0,
    );
    buildResourceSheet(wb, matrix, data.statusDate);
  }

  return {
    buffer: await toBuffer(wb),
    // Tên file mang theo mốc chuẩn: hai bản xuất ở hai kỳ khác nhau không được trùng tên.
    filename: `planix-${data.projectCode}-${options.report}-${data.statusDate}.xlsx`,
    warnings,
  };
}
