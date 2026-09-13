/**
 * Lưu kết quả validate và lịch sử các lượt — SPEC.md §8, màn S6.
 *
 * Cho tới trước đây KHÔNG dòng mã production nào ghi vào `validation_issue`: validate
 * chạy, trả report về cho người gọi, rồi report đó bị vứt đi. Hệ quả là panel Issues
 * luôn trống và chấm đỏ trên cây không bao giờ hiện, kể cả khi dự án hỏng nặng.
 *
 * PM quyết ngày 2026-09-13: giữ lịch sử để trả lời được "issue này xuất hiện từ bao giờ".
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { loadIssues, loadIssuesOfRun } from '../../src/db/repo/read-repo.js';
import {
  loadLastValidationRun,
  loadRecordedIssues,
  loadValidationHistory,
  MAX_RUNS_PER_PROJECT,
  recordValidationRun,
  type RecordedIssue,
} from '../../src/db/repo/issue-repo.js';

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
  for (const [id, code] of [
    ['P', 'UTG'],
    ['Q', 'GEO'],
  ]) {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES (?,?,?,1,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(id, code, code, AT);
  }
});

/** Ghi một lượt với `now` riêng, mặc định nguồn `edit`. */
function record(
  projectId: string,
  issues: readonly RecordedIssue[],
  at = AT,
  source: 'import' | 'schedule' | 'progress' | 'edit' = 'edit',
) {
  return recordValidationRun(db, { runId: `run-${at}`, projectId, detectedAt: at, source, issues });
}

const c04: RecordedIssue = {
  severity: 'Critical',
  code: 'C04',
  message: 'Work task has no role.',
  taskUid: 'T-1',
};
const j05: RecordedIssue = { severity: 'Major', code: 'J05', message: 'Task too large.' };

describe('recordValidationRun', () => {
  it('ghi xuống và đọc lại được qua đúng đường mà màn S6 dùng', () => {
    record('P', [c04, { severity: 'Minor', code: 'N01', message: 'SF is rarely correct.' }]);

    const issues = loadIssues(db, 'P');
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.code).sort()).toEqual(['C04', 'N01']);
    expect(issues.find((i) => i.code === 'C04')?.taskUid).toBe('T-1');
    expect(issues.find((i) => i.code === 'N01')?.taskUid).toBeNull();
  });

  it('panel chỉ hiện issue của lượt MỚI NHẤT, dù lượt cũ vẫn nằm trong lịch sử', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [j05], '2026-09-13T02:00:00.000Z');

    expect(loadIssues(db, 'P').map((i) => i.code)).toEqual(['J05']);
    expect(loadValidationHistory(db, 'P')).toHaveLength(2);
  });

  it('lượt sạch làm panel trống, nhưng KHÔNG xoá lịch sử', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [], '2026-09-13T02:00:00.000Z');

    expect(loadIssues(db, 'P')).toEqual([]);
    const history = loadValidationHistory(db, 'P');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ critical: 0, major: 0, minor: 0 });
    expect(history[1]).toMatchObject({ critical: 1 });
  });

  it('dự án này không đụng vào lịch sử của dự án kia', () => {
    record('Q', [j05]);
    record('P', [c04]);

    expect(loadIssues(db, 'Q').map((i) => i.message)).toEqual(['Task too large.']);
    expect(loadValidationHistory(db, 'Q')).toHaveLength(1);
  });

  it('giữ `detail` — đường đi của C01 nằm trong đó, mất là mất luôn thứ §8.1 đòi', () => {
    record('P', [
      {
        severity: 'Critical',
        code: 'C01',
        message: 'Dependency cycle: A -> B -> A',
        detail: { path: ['A', 'B', 'A'] },
      },
    ]);

    const run = loadLastValidationRun(db, 'P');
    expect(run).not.toBeNull();
    expect(loadRecordedIssues(db, run?.id ?? 0)[0]?.detail).toEqual({ path: ['A', 'B', 'A'] });
  });

  it('issue không có detail thì để NULL, không ghi chuỗi "undefined"', () => {
    record('P', [{ severity: 'Minor', code: 'N01', message: 'x' }]);
    expect(db.prepare('SELECT detail_json FROM validation_issue').get()).toEqual({
      detail_json: null,
    });
  });
});

describe('khử trùng bằng vân tay — lịch sử phải là diễn biến, không phải tiếng ồn', () => {
  it('tập issue y hệt thì KHÔNG đẻ dòng lịch sử mới', () => {
    const first = record('P', [c04], '2026-09-13T01:00:00.000Z');
    const second = record('P', [c04], '2026-09-13T02:00:00.000Z');

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(loadValidationHistory(db, 'P')).toHaveLength(1);
  });

  it('nhưng CÓ đẩy `lastAt`, còn `firstAt` giữ nguyên — đó là câu "xuất hiện từ bao giờ"', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [c04], '2026-09-13T05:00:00.000Z');

    expect(loadLastValidationRun(db, 'P')).toMatchObject({
      firstAt: '2026-09-13T01:00:00.000Z',
      lastAt: '2026-09-13T05:00:00.000Z',
    });
  });

  it('không ghi lại issue lần hai — panel vẫn đúng một bản', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [c04], '2026-09-13T02:00:00.000Z');
    expect(loadIssues(db, 'P')).toHaveLength(1);
  });

  it('thứ tự issue đổi mà tập không đổi thì vẫn là MỘT trạng thái (N2)', () => {
    record('P', [c04, j05], '2026-09-13T01:00:00.000Z');
    const again = record('P', [j05, c04], '2026-09-13T02:00:00.000Z');
    expect(again.changed).toBe(false);
  });

  it('cùng mã lỗi nhưng message khác con số là trạng thái KHÁC', () => {
    record(
      'P',
      [{ severity: 'Major', code: 'J11', message: 'Late by 3 days.' }],
      '2026-09-13T01:00:00.000Z',
    );
    const again = record(
      'P',
      [{ severity: 'Major', code: 'J11', message: 'Late by 9 days.' }],
      '2026-09-13T02:00:00.000Z',
    );
    expect(again.changed).toBe(true);
    expect(loadValidationHistory(db, 'P')).toHaveLength(2);
  });

  it('quay lại đúng tập issue cũ thì đó là một dòng lịch sử MỚI, không phải dòng cũ sống lại', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [], '2026-09-13T02:00:00.000Z');
    record('P', [c04], '2026-09-13T03:00:00.000Z');

    const history = loadValidationHistory(db, 'P');
    expect(history).toHaveLength(3);
    // Lỗi quay lại lúc 03:00 là một lần xuất hiện MỚI — gộp vào dòng 01:00 sẽ nói dối
    // rằng nó chưa từng được sửa.
    expect(history[0]?.firstAt).toBe('2026-09-13T03:00:00.000Z');
  });
});

describe('"lượt mới nhất" theo thứ tự CHÈN, không theo đồng hồ', () => {
  /**
   * `detectedAt` do người gọi truyền vào (`ctx.now`). Một lần chỉnh đồng hồ lùi, hay một
   * request mang `now` cũ, từng đủ để hỏng hai thứ cùng lúc: panel quay về hiện trạng
   * thái cũ, và việc khử trùng so với nhầm dòng nên đẻ ra một dòng lịch sử thừa MỖI LẦN
   * ghi. Phát hiện khi đo hiệu năng: 5 lượt giống hệt nhau lại sinh ra 5 dòng.
   */
  it('lượt ghi sau vẫn là mới nhất dù mang mốc thời gian cũ hơn', () => {
    record('P', [c04], '2026-09-13T09:00:00.000Z');
    record('P', [j05], '2026-09-13T01:00:00.000Z');

    expect(loadIssues(db, 'P').map((i) => i.code)).toEqual(['J05']);
    expect(loadLastValidationRun(db, 'P')?.lastAt).toBe('2026-09-13T01:00:00.000Z');
  });

  it('và việc khử trùng vẫn so với lượt vừa ghi, không với lượt có mốc lớn nhất', () => {
    record('P', [c04], '2026-09-13T09:00:00.000Z');
    record('P', [j05], '2026-09-13T01:00:00.000Z');
    const again = record('P', [j05], '2026-09-13T02:00:00.000Z');

    expect(again.changed).toBe(false);
    expect(loadValidationHistory(db, 'P')).toHaveLength(2);
  });
});

describe('lịch sử có chặn trên', () => {
  it(`giữ tối đa ${String(MAX_RUNS_PER_PROJECT)} lượt, cắt lượt cũ nhất trước`, () => {
    const extra = 5;
    for (let i = 0; i < MAX_RUNS_PER_PROJECT + extra; i++) {
      const at = `2026-09-13T${String(i).padStart(2, '0')}:00:00.000Z`;
      // Mỗi lượt một message khác nhau để vân tay khác nhau, nếu không chúng gộp làm một.
      record('P', [{ severity: 'Major', code: 'J05', message: `run ${String(i)}` }], at);
    }

    const history = loadValidationHistory(db, 'P', MAX_RUNS_PER_PROJECT);
    expect(history).toHaveLength(MAX_RUNS_PER_PROJECT);
    // Lượt bị cắt là lượt GHI SỚM NHẤT, không phải lượt mới nhất.
    const ids = history.map((r) => r.id);
    expect(Math.min(...ids)).toBe(extra + 1);
  });

  it('cắt lượt cũ thì issue của nó đi theo, không để lại dòng mồ côi', () => {
    for (let i = 0; i < MAX_RUNS_PER_PROJECT + 3; i++) {
      const at = `2026-09-13T${String(i).padStart(2, '0')}:00:00.000Z`;
      record('P', [{ severity: 'Major', code: 'J05', message: `run ${String(i)}` }], at);
    }

    const orphans = db
      .prepare(
        `SELECT COUNT(*) n FROM validation_issue i
         WHERE NOT EXISTS (SELECT 1 FROM validation_run r WHERE r.id = i.run_pk)`,
      )
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});

describe('loadLastValidationRun — phân biệt "sạch" với "chưa ai kiểm"', () => {
  it('chưa chạy lần nào thì null', () => {
    expect(loadLastValidationRun(db, 'P')).toBeNull();
  });

  it('chạy rồi mà không có vấn đề gì thì KHÔNG null — đó là "sạch", không phải "chưa biết"', () => {
    record('P', []);
    expect(loadLastValidationRun(db, 'P')).toMatchObject({ critical: 0, major: 0, minor: 0 });
  });

  it('đếm đúng theo từng mức và nhớ nguồn của lượt', () => {
    record(
      'P',
      [
        c04,
        { severity: 'Critical', code: 'C07', message: 'b' },
        j05,
        { severity: 'Minor', code: 'N01', message: 'd' },
      ],
      AT,
      'schedule',
    );
    expect(loadLastValidationRun(db, 'P')).toMatchObject({
      critical: 2,
      major: 1,
      minor: 1,
      source: 'schedule',
    });
  });

  it('xoá dự án thì lịch sử đi theo (ON DELETE CASCADE)', () => {
    record('P', [c04]);
    db.prepare('DELETE FROM project WHERE id = ?').run('P');
    expect(loadLastValidationRun(db, 'P')).toBeNull();
    expect(loadValidationHistory(db, 'P')).toEqual([]);
  });
});

describe('xem lại một lượt cũ', () => {
  it('đọc đúng issue của lượt đó, không phải của lượt hiện tại', () => {
    record('P', [c04], '2026-09-13T01:00:00.000Z');
    record('P', [j05], '2026-09-13T02:00:00.000Z');

    const history = loadValidationHistory(db, 'P');
    const older = history[1];
    expect(older).toBeDefined();
    expect(loadIssuesOfRun(db, older?.id ?? 0).map((i) => i.code)).toEqual(['C04']);
  });
});
