/**
 * §11 — ba bản báo cáo Excel.
 *
 * Ô khó nhất của checklist P10 là §11.5: "Cùng DB + cùng `status_date` → cùng file Excel,
 * kể cả thứ tự dòng." Một file .xlsx là một file zip, và cả metadata workbook lẫn dấu
 * thời gian từng mục trong zip đều mặc định lấy đồng hồ hệ thống — nên hai lần xuất cách
 * nhau một giây sẽ ra hai file khác nhau nếu không ghim lại.
 */

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { scheduleProject } from '../../src/pipeline/schedule-project.js';
import { exportExcel, ExportBlockedError } from '../../src/io/excel/index.js';
import { PINNED_DOS } from '../../src/io/excel/workbook.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P','UTG','UTG リニューアル',1,'2026-03-02','2026-03-02','CAL','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Nguyen A','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  db.prepare(
    `INSERT INTO app_user (id,email,name,password_hash,created_at) VALUES ('U','pm@x.com','PM','h',?)`,
  ).run(AT);

  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: '要件定義', kind: 'summary' },
        { tmp_id: 'm', parent_tmp_id: 'r', name: 'Module 1', kind: 'summary' },
        {
          tmp_id: 'a',
          parent_tmp_id: 'm',
          name: 'タスク A',
          kind: 'work',
          effort_md: 2,
          role: 'Dev',
          phase: 'P1',
        },
        {
          tmp_id: 'b',
          parent_tmp_id: 'm',
          name: 'タスク B',
          kind: 'work',
          effort_md: 3,
          role: 'Dev',
          phase: 'P1',
        },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'SS', lag_days: 2 }],
    },
    { runId: 'I', now: AT },
  );
  scheduleProject(db, { projectId: 'P', runId: 'S', now: AT });
});

const hash = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Đọc ô Excel thành chuỗi. `CellValue` là union rộng (công thức, rich text, lỗi...),
 *  nên ép thẳng qua String() sẽ ra '[object Object]' ở vài kiểu. */
function cell(row: ExcelJS.Row, n: number): string {
  const v: unknown = row.getCell(n).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  // Ô công thức hoặc rich text: lấy phần đọc được, không ép cả object thành chuỗi.
  const rich = v as { text?: unknown; result?: unknown };
  if (typeof rich.text === 'string') return rich.text;
  if (typeof rich.result === 'string') return rich.result;
  if (typeof rich.result === 'number') return String(rich.result);
  return '';
}

async function sheetOf(buffer: Uint8Array, name: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const ws = wb.getWorksheet(name);
  if (ws === undefined) throw new Error(`Không có sheet ${name}`);
  return ws;
}

describe('§11.5 — xuất hai lần ra file GIỐNG HỆT', () => {
  it('bản full: byte-for-byte', async () => {
    const a = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const b = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r2' });
    expect(hash(a.buffer)).toBe(hash(b.buffer));
  });

  it('bản summary: byte-for-byte', async () => {
    const a = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const b = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r2' });
    expect(hash(a.buffer)).toBe(hash(b.buffer));
  });

  it('bản resource: byte-for-byte', async () => {
    const a = await exportExcel(db, { projectId: 'P', report: 'resource', runId: 'r1' });
    const b = await exportExcel(db, { projectId: 'P', report: 'resource', runId: 'r2' });
    expect(hash(a.buffer)).toBe(hash(b.buffer));
  });

  it('MỌI dấu thời gian trong zip đều bị ghim, không phụ thuộc lúc chạy', async () => {
    // Test băm ở trên từng cho kết quả XANH GIẢ: hai lần xuất trong cùng một test rơi vào
    // cùng một khoảng 2 giây của định dạng DOS, nên trùng nhau một cách tình cờ. Chạy qua
    // hai tiến trình cách nhau vài giây thì lộ ra khác. Test này khẳng định thẳng vào giá
    // trị byte nên không thể xanh giả như vậy nữa.
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const buf = Buffer.from(r.buffer);

    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);

    const count = buf.readUInt16LE(eocd + 10);
    expect(count).toBeGreaterThan(0);

    let pos = buf.readUInt32LE(eocd + 16);
    let checked = 0;
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
      expect(buf.readUInt16LE(pos + 12)).toBe(PINNED_DOS.time);
      expect(buf.readUInt16LE(pos + 14)).toBe(PINNED_DOS.date);

      const localOffset = buf.readUInt32LE(pos + 42);
      expect(buf.readUInt16LE(localOffset + 10)).toBe(PINNED_DOS.time);
      expect(buf.readUInt16LE(localOffset + 12)).toBe(PINNED_DOS.date);

      pos +=
        46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
      checked++;
    }
    expect(checked).toBe(count);
  });

  it('file vẫn MỞ ĐƯỢC sau khi ghim dấu thời gian', async () => {
    // Ghi đè byte trong zip mà sai một chỗ là file hỏng im lặng.
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    expect(ws.rowCount).toBeGreaterThan(1);
  });

  it('tên file mang mã dự án và mốc chuẩn', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    expect(r.filename).toBe('planix-UTG-full-2026-03-02.xlsx');
  });
});

describe('§11.2 — bản full', () => {
  it('12 cột, đúng thứ tự spec', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'No.',
      'Task',
      'Category',
      'PIC',
      'Status',
      '%',
      'MD',
      'Plan Start',
      'Plan End',
      'Actual Start',
      'Actual End',
      'Depends on',
    ]);
  });

  it('outlineLevel theo depth — thiếu nó thì 6.000 dòng không đọc nổi', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    const levels = new Map<string, number>();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      levels.set(cell(row, 1), row.outlineLevel ?? 0);
    });
    expect(levels.get('1')).toBe(0);
    expect(levels.get('1.1')).toBe(1);
    expect(levels.get('1.1.1')).toBe(2);
  });

  it('freeze pane tại C2', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    const view = ws.views[0];
    expect(view?.state).toBe('frozen');
    expect((view as { xSplit?: number }).xSplit).toBe(2);
    expect((view as { ySplit?: number }).ySplit).toBe(1);
  });

  it('cột Depends on dùng WBS CODE, kèm lag khi khác 0', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    const labels: string[] = [];
    ws.eachRow((row, n) => {
      if (n > 1) labels.push(cell(row, 12));
    });
    // A là 1.1.1, B phụ thuộc A kiểu SS lag 2.
    expect(labels).toContain('1.1.1 SS+2');
  });

  it('dòng summary in đậm, PIC để trống', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    const row = ws.getRow(2); // wbs 1, summary
    expect(row.getCell(1).value).toBe('1');
    expect(row.font?.bold).toBe(true);
    expect(row.getCell(4).value ?? '').toBe('');
  });

  it('MD của summary là TỔNG của con (§7.7), không phải ô trống', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Full');
    expect(ws.getRow(2).getCell(7).value).toBe(5);
  });
});

describe('§11.3 — bản summary tiếng Nhật', () => {
  it('BẮT BUỘC có 基準日 ở đầu sheet', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');
    expect(cell(ws.getRow(1), 1)).toBe('基準日: 2026-03-02');
  });

  it('header đúng 11 cột tiếng Nhật, ba cấp ba cột', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');
    const headers: string[] = [];
    ws.eachRow((row) => {
      if (cell(row, 1) === '大項目') {
        for (let i = 1; i <= 11; i++) headers.push(cell(row, i));
      }
    });
    expect(headers).toEqual([
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
    ]);
  });

  it('status dịch sang tiếng Nhật', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');
    const values: string[] = [];
    ws.eachRow((row) => values.push(cell(row, 5)));
    expect(values).toContain('未着手');
    expect(values).not.toContain('not_started');
  });

  it('ba cấp nằm ở BA cột riêng, mỗi dòng chỉ điền tới cấp của nó', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');

    const rows: Array<[string, string, string]> = [];
    let seenHeader = false;
    ws.eachRow((row) => {
      if (cell(row, 1) === '大項目') {
        seenHeader = true;
        return;
      }
      if (seenHeader) rows.push([cell(row, 1), cell(row, 2), cell(row, 3)]);
    });

    // Cấp 1: chỉ 大項目. Cấp 2: 大+中. Cấp 3: đủ ba.
    expect(rows).toContainEqual(['要件定義', '', '']);
    expect(rows).toContainEqual(['要件定義', 'Module 1', '']);
    expect(rows).toContainEqual(['要件定義', 'Module 1', 'タスク A']);
  });

  it('depth ngoài 1–3 bị TỪ CHỐI, không lặng lẽ dồn cấp 4 vào cột cấp 3', async () => {
    await expect(
      exportExcel(db, { projectId: 'P', report: 'summary', depth: 4, runId: 'r1' }),
    ).rejects.toThrow(/1 tới 3/);
    await expect(
      exportExcel(db, { projectId: 'P', report: 'summary', depth: 0, runId: 'r1' }),
    ).rejects.toThrow(/1 tới 3/);
  });

  it('cắt theo depth — depth 1 chỉ còn dòng gốc', async () => {
    const deep = await exportExcel(db, {
      projectId: 'P',
      report: 'summary',
      depth: 3,
      runId: 'r1',
    });
    const shallow = await exportExcel(db, {
      projectId: 'P',
      report: 'summary',
      depth: 1,
      runId: 'r2',
    });
    // Đọc TUẦN TỰ vào biến: `xlsx.load` tiêu thụ buffer, nên lồng hai lần đọc vào cùng
    // một biểu thức sẽ hỏng ở lần thứ hai.
    const count = async (b: Uint8Array): Promise<number> => {
      const ws = await sheetOf(Uint8Array.from(b), 'サマリー');
      let n = 0;
      ws.eachRow(() => n++);
      return n;
    };
    const shallowRows = await count(shallow.buffer);
    const deepRows = await count(deep.buffer);
    expect(shallowRows).toBeLessThan(deepRows);
  });

  it('ghi 完了タスク数ベース khi phần lớn task lá là micro task (§7.9)', async () => {
    // Hạ effort xuống dưới ngưỡng 0.5 để cả hai lá thành micro task.
    db.prepare(`UPDATE task SET effort_md = 0.25 WHERE kind = 'work'`).run();
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');
    const first: string[] = [];
    ws.eachRow((row, n) => {
      if (n <= 3) first.push(cell(row, 1));
    });
    expect(first).toContain('完了タスク数ベース');
  });

  it('KHÔNG ghi khi task lá phần lớn là task thường', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'サマリー');
    const first: string[] = [];
    ws.eachRow((row, n) => {
      if (n <= 3) first.push(cell(row, 1));
    });
    expect(first).not.toContain('完了タスク数ベース');
  });
});

describe('§11.1 — bản resource, ma trận người × tuần', () => {
  it('có tên người và tổng MD', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'resource', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Resource');
    const names: string[] = [];
    ws.eachRow((row) => names.push(cell(row, 1)));
    expect(names).toContain('Nguyen A');
    expect(names).toContain('Total');
  });

  it('tổng MD khớp tổng effort của dự án', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'resource', runId: 'r1' });
    const ws = await sheetOf(r.buffer, 'Resource');
    let grand: number | null = null;
    ws.eachRow((row) => {
      if (cell(row, 1) === 'Total') {
        const cells: number[] = [];
        row.eachCell((c) => {
          if (typeof c.value === 'number') cells.push(c.value);
        });
        grand = cells[cells.length - 1] ?? null;
      }
    });
    // 2 MD + 3 MD, rải trên các ngày làm việc.
    expect(grand).toBe(5);
  });
});

describe('§11.4 — chốt chặn trước khi xuất', () => {
  it('có Critical thì TỪ CHỐI xuất', async () => {
    // Bỏ role của task work → C04 Critical.
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    await expect(
      exportExcel(db, { projectId: 'P', report: 'summary', runId: 'r1' }),
    ).rejects.toThrow(ExportBlockedError);
  });

  it('không có Critical thì xuất bình thường, kèm danh sách Major nếu có', async () => {
    const r = await exportExcel(db, { projectId: 'P', report: 'full', runId: 'r1' });
    expect(r.buffer.length).toBeGreaterThan(0);
    expect(Array.isArray(r.warnings)).toBe(true);
  });
});
