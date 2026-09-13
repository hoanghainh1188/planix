/**
 * Bản `summary` tiếng Nhật — SPEC.md §11.3. Bản này đi THẲNG tới khách.
 *
 * §11.4 nói rõ: "Bản summary đi thẳng tới khách Nhật, không được phép chứa mâu thuẫn
 * tổng/chi tiết." Nên mọi con số ở đây lấy từ rollup §7.7, không tính lại.
 *
 * Một chỗ §11.3 để ngỏ: bảng chỉ có hai cột phân cấp (大項目, 中項目) nhưng lại cho hiện
 * "tới cấp chọn trước (mặc định 3)" — tức ba cấp trên hai cột. Cách đọc đã chọn ghi ở
 * docs/decisions/2026-09-13-summary-report-levels.md; cần PM xác nhận.
 */

import type ExcelJS from 'exceljs';
import type { ReportRow } from '../../db/repo/read-repo.js';
import { statusJa } from './workbook.js';

const HEADERS = [
  '大項目',
  '中項目',
  '担当',
  '状況',
  '進捗率（工数ベース）',
  '計画開始',
  '計画完了',
  '実績開始',
  '実績完了',
  '備考',
] as const;

const WIDTHS = [26, 40, 16, 10, 18, 12, 12, 12, 12, 30];

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

  /** Tên tổ tiên ở cấp 1 — cột 大項目. */
  function topLevelName(row: ReportRow): string {
    let cursor: ReportRow | undefined = row;
    const seen = new Set<string>();
    while (cursor !== undefined && cursor.depth > 1) {
      if (seen.has(cursor.uid)) return row.name; // cây hỏng: đừng lặp vô hạn
      seen.add(cursor.uid);
      cursor = cursor.parentUid === null ? undefined : byUid.get(cursor.parentUid);
    }
    return cursor?.name ?? row.name;
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
      row.depth === 1 ? row.name : topLevelName(row),
      // Cấp 1 không có 中項目; cấp sâu hơn thụt lề để phân biệt cấp 2 với cấp 3.
      row.depth === 1 ? '' : `${'    '.repeat(row.depth - 2)}${row.name}`,
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
    line.getCell(5).numFmt = '0.0%';
  }

  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
  return ws;
}
