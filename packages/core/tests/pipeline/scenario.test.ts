import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { scheduleAllProjects } from '../../src/pipeline/schedule-project.js';
import { buildScenario, SCENARIO_AT, type ScenarioHandles } from '../fixtures/scenario.js';
import { buildPayload } from '../fixtures/generate.js';
import { createCalendarEngine } from '../../src/domain/calendar.js';
import { loadCalendarSnapshot } from '../../src/db/repo/calendar-repo.js';
import { unsafeDateOnly as d } from '../../src/domain/date-only.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

let db: Db;
let h: ScenarioHandles;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, SCENARIO_AT);
  h = buildScenario(db, {
    primaryPayload: JSON.parse(readFileSync(join(FIXTURES, 'wbs-500.json'), 'utf8')),
    // Du an thu hai nho hon, dung code khac de cung pool nhan su.
    secondaryPayload: buildPayload(100, 'GEO'),
  });
});
afterEach(() => db.close());

/**
 * CLAUDE.md §4 liệt kê bảy tình huống fixture PHẢI có. Bốn cái đầu nằm trong payload và
 * đã được golden test phủ; ba cái còn lại cần dữ liệu quanh nó, và đây là chỗ kiểm.
 */
describe('fixture phủ đủ tình huống CLAUDE.md §4', () => {
  it('người làm NHIỀU dự án', () => {
    const rows = db
      .prepare('SELECT project_id FROM resource_team WHERE resource_id = ? ORDER BY project_id')
      .all(h.sharedResourceId) as Array<{ project_id: string }>;
    expect(rows.map((r) => r.project_id)).toEqual(['P-MAIN', 'P-SIDE']);
  });

  it('lễ VN CHỒNG nghỉ phép cá nhân — hai lớp exception trên cùng một ngày', () => {
    const rows = db
      .prepare(`SELECT kind FROM calendar_exception WHERE date_from = ? ORDER BY kind`)
      .all(h.overlappedHolidayDate) as Array<{ kind: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['holiday', 'leave']);

    // Va engine phai coi ngay do la nghi, khong phai chi mot lop.
    const engine = createCalendarEngine(loadCalendarSnapshot(db));
    expect(engine.capacityOn(h.sharedResourceId, d(h.overlappedHolidayDate))).toBe(0);
  });

  it('task bị huỷ nằm GIỮA chuỗi FS, có cạnh vào và cạnh ra', () => {
    const incoming = db
      .prepare('SELECT COUNT(*) AS n FROM dependency WHERE succ_uid = ?')
      .get(h.cancelledMidChainUid) as { n: number };
    const outgoing = db
      .prepare('SELECT COUNT(*) AS n FROM dependency WHERE pred_uid = ?')
      .get(h.cancelledMidChainUid) as { n: number };
    expect(incoming.n).toBeGreaterThan(0);
    expect(outgoing.n).toBeGreaterThan(0);

    const status = db
      .prepare('SELECT status FROM progress WHERE task_uid = ?')
      .get(h.cancelledMidChainUid) as { status: string };
    expect(status.status).toBe('cancelled');
  });

  it('pinned_resource trỏ tới người KHÔNG giữ role của task — dựng xung đột tất định', () => {
    const row = db
      .prepare('SELECT pinned_resource, role FROM task WHERE uid = ?')
      .get(h.pinnedOverloadUid) as { pinned_resource: string; role: string };
    expect(row.pinned_resource).toBe(h.pinnedResourceId);
    expect(row.role).toBe(h.pinnedRole);

    const holds = db
      .prepare('SELECT 1 FROM resource_role WHERE resource_id = ? AND role = ?')
      .get(h.pinnedResourceId, h.pinnedRole);
    expect(holds).toBeUndefined();
  });
});

describe('pipeline chạy được trên bối cảnh đầy đủ', () => {
  it('xếp lịch cả hai dự án, task huỷ bị loại, task ghim giữ đúng người', () => {
    const result = scheduleAllProjects(db, {
      runId: 'SCN',
      now: SCENARIO_AT,
      windowDays: 2000,
    });
    expect(result.order).toEqual(['P-MAIN', 'P-SIDE']);

    // Task huy khong co dong schedule (§7.11).
    expect(
      db.prepare('SELECT 1 FROM schedule WHERE task_uid = ?').get(h.cancelledMidChainUid),
    ).toBeUndefined();

    // Task ghim van thuoc dung nguoi da pin (§4.3, N4) — engine KHONG tu doi nguoi du
    // nguoi do khong giu role.
    const pinned = db
      .prepare('SELECT resource_id, is_pinned FROM assignment WHERE task_uid = ?')
      .get(h.pinnedOverloadUid) as { resource_id: string; is_pinned: number } | undefined;
    expect(pinned?.resource_id).toBe(h.pinnedResourceId);
    expect(pinned?.is_pinned).toBe(1);

    // Va phai bao J01 chu khong im lang (§8.2).
    const main = result.perProject.get('P-MAIN');
    expect(main?.issues.some((i) => i.code === 'J01')).toBe(true);
  });

  it('bắc cầu qua task huỷ: task sau vẫn bị ràng buộc bởi task trước (§6.5)', () => {
    const around = db
      .prepare(
        `SELECT pred_uid, succ_uid FROM dependency
         WHERE succ_uid = ? OR pred_uid = ? ORDER BY pred_uid`,
      )
      .all(h.cancelledMidChainUid, h.cancelledMidChainUid) as Array<{
      pred_uid: string;
      succ_uid: string;
    }>;
    const before = around.find((r) => r.succ_uid === h.cancelledMidChainUid)?.pred_uid;
    const after = around.find((r) => r.pred_uid === h.cancelledMidChainUid)?.succ_uid;
    expect(before).toBeDefined();
    expect(after).toBeDefined();

    scheduleAllProjects(db, { runId: 'SCN', now: SCENARIO_AT, windowDays: 2000 });

    const get = (uid: string) =>
      db.prepare('SELECT start_date, end_date FROM schedule WHERE task_uid = ?').get(uid) as
        { start_date: string; end_date: string } | undefined;

    const a = get(before!);
    const c = get(after!);
    expect(a).toBeDefined();
    expect(c).toBeDefined();
    // Canh bac cau la FS voi lag cong don 1 + 2 = 3 ngay lam viec.
    expect(c!.start_date > a!.end_date).toBe(true);
  });

  it('người dùng chung không bị đặt quá 100% giữa hai dự án', () => {
    scheduleAllProjects(db, { runId: 'SCN', now: SCENARIO_AT, windowDays: 2000 });

    const rows = db
      .prepare('SELECT from_date, to_date, allocation FROM assignment WHERE resource_id = ?')
      .all(h.sharedResourceId) as Array<{
      from_date: string;
      to_date: string;
      allocation: number;
    }>;

    const perDay = new Map<string, number>();
    for (const a of rows) {
      for (
        let cur = new Date(a.from_date);
        cur <= new Date(a.to_date);
        cur.setDate(cur.getDate() + 1)
      ) {
        const key = cur.toISOString().slice(0, 10);
        perDay.set(key, (perDay.get(key) ?? 0) + a.allocation);
      }
    }
    expect([...perDay.values()].filter((v) => v > 1.0001)).toEqual([]);
  });

  it('không ai được xếp việc vào ngày lễ chồng nghỉ phép', () => {
    scheduleAllProjects(db, { runId: 'SCN', now: SCENARIO_AT, windowDays: 2000 });

    const engine = createCalendarEngine(loadCalendarSnapshot(db));
    expect(engine.capacityOn(h.sharedResourceId, d(h.overlappedHolidayDate))).toBe(0);
  });
});
