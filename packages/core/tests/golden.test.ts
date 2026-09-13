import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/migrate.js';
import { importTasks, type ImportResult } from '../src/io/importer.js';
import { buildPayload, ROLES } from './fixtures/generate.js';
import { AT, buildSnapshot, FIXTURE_SIZES, seedProject } from './golden-helpers.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
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

/**
 * Mở DB, import, chạy `use`, rồi ĐÓNG trong finally.
 *
 * better-sqlite3 giữ bộ nhớ native cho tới khi `close()`. Bỏ quên nó thì với fixture
 * 6.000 task chạy nhiều lượt, cộng coverage instrumentation, worker của vitest bị
 * SIGSEGV trên runner ít RAM. Máy dev RAM rộng không lộ ra — CI mới bắt được.
 */
function withImport<T>(
  size: number,
  use: (db: Db, result: ImportResult, elapsedMs: number) => T,
): T {
  const db = openDatabase(':memory:');
  try {
    migrate(db, AT);
    seedProject(db, [...ROLES]);

    const started = performance.now();
    const result = importTasks(db, loadPayload(size), { runId: 'GOLDEN', now: AT });
    const elapsedMs = performance.now() - started;

    return use(db, result, elapsedMs);
  } finally {
    db.close();
  }
}

function snapshotOf(size: number): string {
  return withImport(size, (db, result) => buildSnapshot(db, result));
}

describe.each(FIXTURE_SIZES)('golden — fixture %i task (§14.5)', (size) => {
  it('bất biến: đúng số task, đúng một gốc, wbs_code hợp lệ và khớp depth', () => {
    withImport(size, (db) => {
      const rows = db
        .prepare('SELECT uid, wbs_code, depth, parent_uid FROM task ORDER BY uid')
        .all() as Array<{
        uid: string;
        wbs_code: string;
        depth: number;
        parent_uid: string | null;
      }>;

      expect(rows.length).toBe(size);
      expect(rows.filter((r) => r.parent_uid === null).length).toBe(1); // C08

      for (const r of rows) {
        expect(r.wbs_code).toMatch(/^\d+(\.\d+)*$/);
        expect(r.wbs_code.split('.').length).toBe(r.depth);
        expect(r.depth).toBeGreaterThanOrEqual(1);
        expect(r.depth).toBeLessThanOrEqual(6); // §1.5 thiết kế tới 6 cấp
      }

      // Trùng mã nghĩa là renumber sai.
      expect(new Set(rows.map((r) => r.wbs_code)).size).toBe(size);
    });
  });

  it('chạy 2 lần trên DB sạch ra kết quả GIỐNG HỆT (M2)', () => {
    expect(snapshotOf(size)).toBe(snapshotOf(size));
  });

  it('khớp byte-for-byte với kết quả kỳ vọng đã commit', () => {
    const expectedPath = join(FIXTURES, `wbs-${size}.expected.json`);
    const snapshot = snapshotOf(size);

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
    withImport(6000, (_db, _result, elapsedMs) => {
      // In ra để thấy biên còn bao nhiêu, không chỉ pass/fail.
      console.info(`import 6000 task: ${elapsedMs.toFixed(0)} ms`);
      expect(elapsedMs).toBeLessThan(5000);
    });
  });
});
