/**
 * Golden riêng cho fixture VI PHẠM — SPEC.md §8.2, §8.3.
 *
 * Tách khỏi `golden.test.ts` một cách có chủ ý. Ba fixture 20/500/6.000 mô tả một dự án
 * **lành**, và golden của chúng là mốc để phát hiện engine đổi hành vi. Fixture ở đây thì
 * ngược lại: nó cố ý sai ở mọi chỗ mà một rule §8 nhìn thấy được lúc import, và golden của
 * nó khoá lại **đúng từng câu chữ** của báo cáo.
 *
 * Vì sao cần khoá cả câu chữ: thông điệp là thứ PM đọc. Đổi `severity` hay đổi câu thành
 * một câu mơ hồ hơn đều là thay đổi hành vi mà không test nào khác bắt được — unit test
 * của từng rule chỉ kiểm rule đó có bắn hay không.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db/migrate.js';
import { importTasks } from '../src/io/importer.js';
import { buildRulesPayload } from './fixtures/rules-payload.js';
import { ROLES } from './fixtures/generate.js';
import { AT, seedProject } from './golden-helpers.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PAYLOAD_PATH = join(FIXTURES, 'wbs-rules.json');
const EXPECTED_PATH = join(FIXTURES, 'wbs-rules.expected.json');
const UPDATING = process.env['GOLDEN_UPDATE'] === '1';

/** Đọc payload ĐÃ COMMIT, không gọi builder — cùng lý do với `golden.test.ts`. */
function loadPayload(): unknown {
  if (UPDATING) {
    writeFileSync(PAYLOAD_PATH, `${JSON.stringify(buildRulesPayload(), null, 2)}\n`, 'utf8');
  }
  return JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'));
}

function runImport(): { issues: unknown; taskCount: number } {
  const db = openDatabase(':memory:');
  try {
    migrate(db, AT);
    seedProject(db, [...ROLES]);
    const result = importTasks(db, loadPayload(), { runId: 'GOLDEN-RULES', now: AT });
    const taskCount = (db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }).n;
    return { issues: result.report, taskCount };
  } finally {
    db.close();
  }
}

function snapshot(): string {
  const { issues } = runImport();
  return `${JSON.stringify(issues, null, 2)}\n`;
}

describe('golden — fixture vi phạm (§8.2, §8.3)', () => {
  it('import TRÓT LỌT: fixture cố ý chỉ có Major/Minor, không Critical', () => {
    // Critical làm rollback (§9.3) và khi đó không còn gì để chụp. Nếu bài này đỏ, nghĩa
    // là fixture vừa sinh ra một Critical ngoài ý muốn — sửa fixture, đừng sửa kỳ vọng.
    const { taskCount } = runImport();
    expect(taskCount).toBeGreaterThan(0);
  });

  it('phủ đủ các rule nhìn thấy được lúc import', () => {
    const report = runImport().issues as { issues: Array<{ code: string }> };
    const codes = new Set(report.issues.map((i) => i.code));
    // `N04` nhánh sâu, `N05` trùng tên, `N03` thiếu nhãn, `J05` lá quá to,
    // `N01` SF, `N02` lead quá nửa, `N08` lá sang lá khác cha, `N10` cụm sequential.
    for (const code of ['J05', 'N01', 'N02', 'N03', 'N04', 'N05', 'N08', 'N10']) {
      expect(codes).toContain(code);
    }
  });

  it('chạy 2 lần ra kết quả GIỐNG HỆT (M2)', () => {
    expect(snapshot()).toBe(snapshot());
  });

  it('khớp byte-for-byte với kết quả kỳ vọng đã commit', () => {
    const current = snapshot();
    if (UPDATING) writeFileSync(EXPECTED_PATH, current, 'utf8');
    if (!existsSync(EXPECTED_PATH)) {
      throw new Error(`Thiếu ${EXPECTED_PATH}. Sinh lần đầu bằng: GOLDEN_UPDATE=1 npm run test`);
    }
    expect(current).toBe(readFileSync(EXPECTED_PATH, 'utf8'));
  });
});
