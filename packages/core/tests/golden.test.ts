import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/migrate.js';
import { importTasks } from '../src/io/importer.js';
import { buildPayload, ROLES } from './fixtures/generate.js';
import { buildSnapshot, seedProject, FIXTURE_SIZES, AT } from './golden-helpers.js';

const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/fixtures';

const UPDATING = process.env['GOLDEN_UPDATE'] === '1';

/**
 * Đọc payload ĐÃ COMMIT, không gọi generator.
 *
 * Nếu golden test lấy input thẳng từ generator thì sửa generator sẽ lặng lẽ đổi cả
 * input lẫn kết quả, và test vẫn xanh trong khi đang đo một thứ khác. Input phải là
 * file cố định trên đĩa; generator chỉ dùng lúc tạo lại fixture.
 */
function loadPayload(size: number): unknown {
  const path = join(FIXTURES, `wbs-${size}.json`);
  if (UPDATING) {
    writeFileSync(path, `${JSON.stringify(buildPayload(size), null, 2)}\n`, 'utf8');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runImport(size: number): { db: Db; snapshot: string; elapsedMs: number } {
  const db = openDatabase(':memory:');
  migrate(db, AT);
  seedProject(db, [...ROLES]);

  const started = performance.now();
  const result = importTasks(db, loadPayload(size), { runId: 'GOLDEN', now: AT });
  const elapsedMs = performance.now() - started;

  return { db, snapshot: buildSnapshot(db, result), elapsedMs };
}

describe.each(FIXTURE_SIZES)('golden — fixture %i task (§14.5)', (size) => {
  it('bất biến: đúng số task, không Critical, wbs_code và depth hợp lệ', () => {
    const { db } = runImport(size);

    const rows = db
      .prepare('SELECT uid, wbs_code, depth, parent_uid FROM task ORDER BY uid')
      .all() as Array<{ uid: string; wbs_code: string; depth: number; parent_uid: string | null }>;

    expect(rows.length).toBe(size);

    // Đúng một gốc (C08).
    expect(rows.filter((r) => r.parent_uid === null).length).toBe(1);

    // wbs_code dạng 1 hoặc 1.2.3, và số đoạn khớp depth.
    for (const r of rows) {
      expect(r.wbs_code).toMatch(/^\d+(\.\d+)*$/);
      expect(r.wbs_code.split('.').length).toBe(r.depth);
      expect(r.depth).toBeGreaterThanOrEqual(1);
      expect(r.depth).toBeLessThanOrEqual(6); // §1.5 thiết kế tới 6 cấp
    }

    // wbs_code duy nhất — trùng mã nghĩa là renumber sai.
    expect(new Set(rows.map((r) => r.wbs_code)).size).toBe(size);
  });

  it('chạy 2 lần trên DB sạch ra kết quả GIỐNG HỆT (M2)', () => {
    expect(runImport(size).snapshot).toBe(runImport(size).snapshot);
  });

  it('khớp byte-for-byte với kết quả kỳ vọng đã commit', () => {
    const expectedPath = join(FIXTURES, `wbs-${size}.expected.json`);
    const { snapshot } = runImport(size);

    // Ghi đè CHỈ khi được yêu cầu tường minh: GOLDEN_UPDATE=1 npm run test.
    // CLAUDE.md §4: golden test đỏ là không được merge. Muốn đổi kết quả kỳ vọng thì
    // làm thành commit riêng, giải thích rõ vì sao — không phải chạy lệnh này cho hết đỏ.
    if (UPDATING) {
      writeFileSync(expectedPath, snapshot, 'utf8');
    }

    if (!existsSync(expectedPath)) {
      throw new Error(`Thiếu ${expectedPath}. Sinh lần đầu bằng: GOLDEN_UPDATE=1 npm run test`);
    }

    // So sánh byte-for-byte, KHÔNG "gần đúng" (CLAUDE.md §4).
    expect(snapshot).toBe(readFileSync(expectedPath, 'utf8'));
  });
});

describe('hiệu năng import (§14.2 P1)', () => {
  it('6.000 task import dưới 5 giây', () => {
    const { elapsedMs } = runImport(6000);
    // In ra để thấy biên còn bao nhiêu, không chỉ pass/fail.
    console.info(`import 6000 task: ${elapsedMs.toFixed(0)} ms`);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
