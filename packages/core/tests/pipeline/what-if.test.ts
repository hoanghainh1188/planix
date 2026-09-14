/**
 * `wbs_what_if` — §12.3, quy tắc §12.4: *"chạy trên bản sao DB trong RAM. Tuyệt đối
 * không ghi."*
 *
 * Bài test quan trọng nhất của file không phải "kết quả có hợp lý không" mà là **DB thật
 * không đổi một byte nào**. Đó là bất biến duy nhất mà vi phạm một lần là sửa dữ liệu
 * thật của một dự án đang chạy, không có lệnh hoàn tác.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { buildScenario, SCENARIO_AT } from '../fixtures/scenario.js';
import { buildPayload } from '../fixtures/generate.js';
import { scheduleAllProjects } from '../../src/pipeline/schedule-project.js';
import { runWhatIf, WhatIfChangeError, type WhatIfChange } from '../../src/pipeline/what-if.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, SCENARIO_AT);
  buildScenario(db, {
    primaryPayload: JSON.parse(readFileSync(join(FIXTURES, 'wbs-500.json'), 'utf8')),
    secondaryPayload: buildPayload(100, 'GEO'),
  });
  scheduleAllProjects(db, { runId: 'BASE', now: SCENARIO_AT, windowDays: 2000 });
});
afterEach(() => db.close());

/** Ảnh chụp toàn bộ DB, dùng để chứng minh không có gì đổi. */
function snapshot(): string {
  return db.serialize().toString('base64');
}

function run(changes: readonly WhatIfChange[]) {
  return runWhatIf(db, {
    projectId: 'P-MAIN',
    changes,
    runId: 'WI',
    now: SCENARIO_AT,
  });
}

function anyWorkTask(): string {
  return (
    db
      .prepare(
        `SELECT t.uid FROM task t JOIN schedule s ON s.task_uid = t.uid
          WHERE t.project_id = 'P-MAIN' AND t.kind = 'work' AND t.effort_md > 0
          ORDER BY t.uid LIMIT 1`,
      )
      .get() as { uid: string }
  ).uid;
}

describe('§12.4 — tuyệt đối không ghi', () => {
  /**
   * So sánh TOÀN BỘ file DB trước và sau, byte-for-byte.
   *
   * Kiểm từng bảng một sẽ bỏ sót đúng bảng mình quên nghĩ tới — và bảng bị quên thường
   * là bảng mới thêm sau này. `serialize()` không bỏ sót gì.
   */
  it('DB thật không đổi một byte nào sau khi chạy kịch bản nặng', () => {
    const before = snapshot();

    run([
      { kind: 'set_effort', taskUid: anyWorkTask(), effortMd: 99 },
      {
        kind: 'add_resource',
        resourceId: 'R-MOI',
        name: 'Người mới',
        roles: ['Dev', 'BrSE', 'QA', 'PM', 'Comtor'],
      },
    ]);

    expect(snapshot()).toBe(before);
  });

  it('không ghi kể cả khi kịch bản NÉM giữa chừng', () => {
    const before = snapshot();

    expect(() =>
      run([
        { kind: 'set_effort', taskUid: anyWorkTask(), effortMd: 42 },
        // Thay đổi thứ hai hỏng. Nếu bản sao không được dọn, hoặc nếu ai đó lỡ áp thay
        // đổi lên DB thật, thì thay đổi THỨ NHẤT đã kịp để lại dấu vết.
        { kind: 'set_effort', taskUid: 'T-KHONG-CO', effortMd: 1 },
      ]),
    ).toThrow(WhatIfChangeError);

    expect(snapshot()).toBe(before);
  });

  it('chạy nhiều lần liên tiếp vẫn không đổi gì', () => {
    const before = snapshot();
    const uid = anyWorkTask();
    for (let i = 0; i < 3; i += 1) {
      run([{ kind: 'set_effort', taskUid: uid, effortMd: 10 + i }]);
    }
    expect(snapshot()).toBe(before);
  });
});

describe('kết quả kịch bản', () => {
  it('không thay đổi gì thì không có gì trượt', () => {
    const out = run([]);
    expect(out.applied).toEqual([]);
    expect(out.endShiftDays).toBe(0);
    expect(out.diff.added).toEqual([]);
    expect(out.diff.removed).toEqual([]);
    expect(out.diff.effortChanged).toEqual([]);
    expect(out.diff.slipped).toEqual([]);
  });

  it('tăng effort một task thì effortChanged nói đúng task đó', () => {
    const uid = anyWorkTask();
    const out = run([{ kind: 'set_effort', taskUid: uid, effortMd: 40 }]);

    expect(out.applied).toHaveLength(1);
    expect(out.diff.effortChanged.map((c) => c.uid)).toContain(uid);
    expect(out.after.totalMd).toBeGreaterThan(out.before.totalMd);
  });

  /**
   * Câu hỏi §7.2 sinh ra để trả lời: *"nếu thêm một người thì xong sớm hơn bao nhiêu?"*
   *
   * Thêm một người đảm nhiệm mọi role thì dự án không được phép kết thúc MUỘN hơn — nếu
   * muộn hơn thì hoặc engine bất định, hoặc what-if đang đo sai.
   */
  it('thêm người không làm dự án kết thúc muộn hơn', () => {
    const out = run([
      {
        kind: 'add_resource',
        resourceId: 'R-THEM',
        name: 'Thêm một Dev',
        roles: ['Dev', 'BrSE', 'QA', 'PM', 'Comtor'],
      },
    ]);
    expect(out.endShiftDays).not.toBeNull();
    expect(out.endShiftDays ?? 0).toBeLessThanOrEqual(0);
  });

  it('bỏ một người không làm dự án kết thúc sớm hơn', () => {
    const victim = (
      db
        .prepare(
          `SELECT a.resource_id AS id FROM assignment a
             JOIN task t ON t.uid = a.task_uid
            WHERE t.project_id = 'P-MAIN' GROUP BY a.resource_id
            ORDER BY COUNT(*) DESC LIMIT 1`,
        )
        .get() as { id: string }
    ).id;

    const out = run([{ kind: 'remove_resource', resourceId: victim }]);
    expect(out.endShiftDays ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('kèm báo cáo §8 của trạng thái giả định', () => {
    const out = run([{ kind: 'set_effort', taskUid: anyWorkTask(), effortMd: 3 }]);
    expect(out.validation.projectId).toBe('P-MAIN');
    expect(out.validation.counts).toBeDefined();
  });

  /** Ghim vào người rồi bỏ chính người đó: không được ném, vì ghim phải bị gỡ trước. */
  it('bỏ người đang bị ghim thì gỡ ghim, không ném', () => {
    const uid = anyWorkTask();
    const someone = (
      db.prepare('SELECT id FROM resource ORDER BY id LIMIT 1').get() as { id: string }
    ).id;

    const out = run([
      { kind: 'pin_resource', taskUid: uid, resourceId: someone },
      { kind: 'remove_resource', resourceId: someone },
    ]);
    expect(out.applied).toHaveLength(2);
  });

  it('thay đổi trỏ vào thứ không tồn tại thì ném rõ ràng', () => {
    expect(() => run([{ kind: 'remove_resource', resourceId: 'R-KHONG-CO' }])).toThrow(
      WhatIfChangeError,
    );
    expect(() =>
      run([{ kind: 'remove_dependency', predUid: 'T-0001', succUid: 'T-0002', type: 'FS' }]),
    ).toThrow(WhatIfChangeError);
  });

  /** M2: cùng kịch bản trên cùng dữ liệu phải cho cùng kết quả. */
  it('tất định — chạy hai lần cho kết quả trùng khít', () => {
    const changes: WhatIfChange[] = [{ kind: 'set_effort', taskUid: anyWorkTask(), effortMd: 12 }];
    expect(JSON.stringify(run(changes))).toBe(JSON.stringify(run(changes)));
  });
});

/**
 * DB dạng FILE — chỗ mọi test khác không với tới.
 *
 * `openDatabase` bật WAL cho file (§3.1), và SQLite KHÔNG dùng WAL cho DB trong RAM. Mở
 * thẳng ảnh chụp của một file WAL sẽ ném `SQLITE_CANTOPEN`.
 *
 * Đây đúng là lỗi đã xảy ra: mọi test dùng `:memory:`, mà DB trong RAM không bao giờ ở
 * chế độ WAL — nên toàn bộ test xanh trong khi tính năng hỏng hoàn toàn trên môi trường
 * thật. Chỉ lộ ra khi chạy thử trên `data/dev.db`.
 */
describe('trên DB dạng file (WAL)', () => {
  let dir: string;
  let fileDb: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'planix-whatif-'));
    fileDb = openDatabase(join(dir, 'app.db'));
    migrate(fileDb, SCENARIO_AT);
    buildScenario(fileDb, {
      primaryPayload: JSON.parse(readFileSync(join(FIXTURES, 'wbs-20.json'), 'utf8')),
      secondaryPayload: buildPayload(20, 'GEO'),
    });
    scheduleAllProjects(fileDb, { runId: 'BASE', now: SCENARIO_AT, windowDays: 2000 });
  });
  afterEach(() => {
    fileDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('chạy được, không ném CANTOPEN', () => {
    expect(fileDb.pragma('journal_mode', { simple: true })).toBe('wal');

    const uid = (
      fileDb
        .prepare(
          `SELECT uid FROM task WHERE project_id = 'P-MAIN' AND kind = 'work' ORDER BY uid LIMIT 1`,
        )
        .get() as { uid: string }
    ).uid;

    const out = runWhatIf(fileDb, {
      projectId: 'P-MAIN',
      changes: [{ kind: 'set_effort', taskUid: uid, effortMd: 15 }],
      runId: 'WI-FILE',
      now: SCENARIO_AT,
    });
    expect(out.applied).toHaveLength(1);
    expect(out.diff.effortChanged.map((c) => c.uid)).toContain(uid);
  });

  it('không ghi gì vào file thật', () => {
    const before = fileDb.serialize().toString('base64');
    const uid = (
      fileDb
        .prepare(
          `SELECT uid FROM task WHERE project_id = 'P-MAIN' AND kind = 'work' ORDER BY uid LIMIT 1`,
        )
        .get() as { uid: string }
    ).uid;

    runWhatIf(fileDb, {
      projectId: 'P-MAIN',
      changes: [{ kind: 'set_effort', taskUid: uid, effortMd: 77 }],
      runId: 'WI-FILE2',
      now: SCENARIO_AT,
    });

    expect(fileDb.serialize().toString('base64')).toBe(before);
  });
});
