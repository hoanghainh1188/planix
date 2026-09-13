/**
 * Bản `full` — SPEC.md §11.2. 12 cột, dành cho nội bộ.
 *
 * `outlineLevel` là thứ §11.2 gọi là bắt buộc: "Không có là 6.000 dòng không đọc nổi."
 * Nó cho Excel thu gọn cả nhánh bằng một cú bấm, đúng như cây WBS trên màn hình.
 */

import type ExcelJS from 'exceljs';
import type { ReportRow } from '../../db/repo/read-repo.js';
import { indent } from './workbook.js';

/** §11.2 bảng cột, đúng thứ tự A–L. */
const COLUMNS: ReadonlyArray<{ header: string; width: number }> = [
  { header: 'No.', width: 12 },
  { header: 'Task', width: 46 },
  { header: 'Category', width: 14 },
  { header: 'PIC', width: 16 },
  { header: 'Status', width: 13 },
  { header: '%', width: 7 },
  { header: 'MD', width: 8 },
  { header: 'Plan Start', width: 12 },
  { header: 'Plan End', width: 12 },
  { header: 'Actual Start', width: 12 },
  { header: 'Actual End', width: 12 },
  { header: 'Depends on', width: 26 },
];

const ORANGE = 'FFC05621';
const PINK = 'FFFCE4EC';

export function buildFullSheet(
  wb: ExcelJS.Workbook,
  rows: readonly ReportRow[],
  statusDate: string,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Full');

  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const isSummary = row.kind === 'summary';
    const line = ws.addRow([
      row.wbsCode,
      indent(row.name, row.depth),
      row.category ?? '',
      row.pic ?? '',
      row.status.replace('_', ' '),
      // §11.2 cột F: micro task chỉ 0 hoặc 100.
      row.isMicro ? (row.status === 'done' ? 100 : 0) : row.percent,
      row.effortMd ?? '',
      row.planStart ?? '',
      row.planEnd ?? '',
      row.actualStart ?? '',
      row.actualEnd ?? '',
      row.dependsOn,
    ]);

    // §11.2: "outlineLevel theo depth". Excel đếm từ 0 ở cấp ngoài cùng.
    line.outlineLevel = Math.max(0, row.depth - 1);
    // §11.2: "Dòng summary in đậm, không tô màu."
    if (isSummary) line.font = { bold: true };

    // §11.2 luật 1 — Actual End > Plan End thì chữ cam.
    if (row.actualEnd !== null && row.planEnd !== null && row.actualEnd > row.planEnd) {
      line.getCell(11).font = { color: { argb: ORANGE }, bold: isSummary };
    }
    // §11.2 luật 2 — quá hạn mà chưa xong thì nền hồng nhạt.
    if (row.planEnd !== null && row.planEnd < statusDate && row.status !== 'done') {
      line.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
    }
  }

  // §11.2: freeze pane tại C2 — giữ cột No./Task và hàng header khi cuộn.
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  // §11.2: AutoFilter trên header.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  // Cho phép thu gọn nhóm bằng nút ở PHÍA TRÊN, đúng chiều cây WBS đọc từ trên xuống.
  ws.properties.outlineLevelRow = 0;
  ws.getColumn(6).numFmt = '0';
  ws.getColumn(7).numFmt = '0.##';

  return ws;
}
