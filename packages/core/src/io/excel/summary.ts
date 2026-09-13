/**
 * Bản `summary` tiếng Nhật — SPEC.md §11.3. Bản này đi THẲNG tới khách.
 *
 * §11.4 nói rõ: "Bản summary đi thẳng tới khách Nhật, không được phép chứa mâu thuẫn
 * tổng/chi tiết." Nên mọi con số ở đây lấy từ rollup §7.7, không tính lại.
 *
 * Ba cấp, ba cột: 大項目 / 中項目 / 小項目 — PM chốt ngày 2026-09-13. Bản §11.3 đầu tiên
 * chỉ có hai cột phân cấp nhưng lại cho hiện tới cấp 3, nên tên task cấp 3 không có chỗ
 * đứng. §11.3 đã được sửa theo.
 *
 * Hệ quả: bản này hiện được TỐI ĐA 3 cấp, vì có đúng ba cột. `depth` ngoài khoảng 1–3 bị
 * từ chối thay vì lặng lẽ dồn cấp 4 vào cột cấp 3.
 */

import type ExcelJS from 'exceljs';
import type { ReportRow } from '../../db/repo/read-repo.js';
import { statusJa } from './workbook.js';

const HEADERS = [
  '大項目',
  '中項目',
  '小項目',
  '担当',
  '状況',
  '進捗率（工数ベース）',
  '計画開始',
  '計画完了',
  '実績開始',
  '実績完了',
  '備考',
] as const;

const WIDTHS = [24, 28, 34, 16, 10, 18, 12, 12, 12, 12, 30];

/** Số cột phân cấp của §11.3 — cũng là số cấp sâu nhất bản này hiện được. */
export const MAX_SUMMARY_DEPTH = 3;

export interface SummaryOptions {
  readonly maxDepth: number;
  readonly statusDate: string;
  /** Phần lớn task lá là micro task → ghi thêm 完了タスク数ベース (§11.3). */
  readonly microDominant: boolean;
}

export function buildSummarySheet(
  wb: ExcelJS.Workbook,
  rows: readonly ReportRow[],
  options: SummaryOptions,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('サマリー');
  const byUid = new Map(rows.map((r) => [r.uid, r]));

  /**
   * Tên tổ tiên của dòng ở đúng `level`, hoặc tên chính nó khi `level` bằng depth.
   *
   * Đi ngược lên cây thay vì dựa vào `wbs_code`: mã có thể đổi sau mỗi lần renumber
   * (§4.3), còn quan hệ cha–con thì không.
   */
  function ancestorAt(row: ReportRow, level: number): string {
    if (level > row.depth) return '';
    let cursor: ReportRow | undefined = row;
    const seen = new Set<string>();
    while (cursor !== undefined && cursor.depth > level) {
      if (seen.has(cursor.uid)) return ''; // cây hỏng: đừng lặp vô hạn
      seen.add(cursor.uid);
      cursor = cursor.parentUid === null ? undefined : byUid.get(cursor.parentUid);
    }
    return cursor?.name ?? '';
  }

  // §11.3: "Bắt buộc ghi 基準日" — khách Nhật đọc số liệu phải biết nó chốt ngày nào.
  ws.addRow([`基準日: ${options.statusDate}`]);
  if (options.microDominant) {
    ws.addRow(['完了タスク数ベース']);
  }
  ws.addRow([]);

  const headerRow = ws.addRow([...HEADERS]);
  headerRow.font = { bold: true };
  WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  for (const row of rows) {
    if (row.depth > options.maxDepth) continue;

    const line = ws.addRow([
      // Mỗi cấp một cột: dòng cấp 2 để trống 小項目, dòng cấp 1 để trống cả hai.
      ancestorAt(row, 1),
      ancestorAt(row, 2),
      ancestorAt(row, 3),
      row.pic ?? '',
      statusJa(row.status),
      row.percent / 100,
      row.planStart ?? '',
      row.planEnd ?? '',
      row.actualStart ?? '',
      row.actualEnd ?? '',
      // §11.3: 備考 chỉ lấy blocked_note, và chỉ với task đang bị chặn.
      row.status === 'blocked' ? (row.blockedNote ?? '') : '',
    ]);
    if (row.depth === 1) line.font = { bold: true };
    line.getCell(6).numFmt = '0.0%';
  }

  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
  return ws;
}
