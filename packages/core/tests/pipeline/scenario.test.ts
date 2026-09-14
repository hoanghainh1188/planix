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

/**
 * §7 pha C bước C1 — đường găng sau khi san tài nguyên.
 *
 * Kiểm ở mức pipeline chứ không chỉ unit: lỗi thật đã gặp nằm ĐÚNG ở chỗ ghép, không ở
 * thuật toán. `resourceCriticalPath` chạy đúng trên mọi ca unit, nhưng pipeline đưa cho
 * nó bản lịch đã GỠ nút gộp — một đồ thị thủng lỗ. Mỗi chỗ thủng cắt đứt chuỗi.
 *
 * Đo trên `data/dev.db` trước khi sửa: đúng một nút gộp trên đường đi đã cắt chuỗi UTG
 * từ 9 tháng (2026-03-02 → 2026-11-27) xuống còn 6 tuần cuối (2026-10-16 → 2026-11-27).
 */
describe('§7 pha C — đường găng sau san tài nguyên', () => {
  interface Row {
    readonly uid: string;
    readonly start_date: string;
    readonly end_date: string;
    readonly is_critical: number;
    readonly is_resource_critical: number;
  }

  function rows(projectId: string): Row[] {
    return db
      .prepare(
        `SELECT t.uid, s.start_date, s.end_date, s.is_critical, s.is_resource_critical
           FROM task t JOIN schedule s ON s.task_uid = t.uid
          WHERE t.project_id = ? ORDER BY t.uid`,
      )
      .all(projectId) as Row[];
  }

  beforeEach(() => {
    scheduleAllProjects(db, { runId: 'RC', now: SCENARIO_AT, windowDays: 2000 });
  });

  it('có ghi cột, không còn để nguyên 0 như trước', () => {
    const marked = rows('P-MAIN').filter((r) => r.is_resource_critical === 1);
    expect(marked.length).toBeGreaterThan(0);
  });

  it('chuỗi chạm được ngày kết thúc dự án', () => {
    const all = rows('P-MAIN');
    const projectEnd = all.reduce((m, r) => (r.end_date > m ? r.end_date : m), '');
    const marked = all.filter((r) => r.is_resource_critical === 1);
    expect(marked.some((r) => r.end_date === projectEnd)).toBe(true);
  });

  /**
   * Đây là test bắt được lỗi nút gộp. Chuỗi bị cắt vẫn "chạm ngày kết thúc" — nó chỉ
   * ngắn đi ở đầu kia. Phải đo ĐỘ PHỦ mới thấy.
   */
  it('chuỗi phủ phần lớn vòng đời dự án, không chỉ đoạn cuối', () => {
    const all = rows('P-MAIN');
    const marked = all.filter((r) => r.is_resource_critical === 1);
    expect(marked.length).toBeGreaterThan(0);

    const toTime = (s: string): number => new Date(`${s}T00:00:00Z`).getTime();
    const projectStart = all.reduce((m, r) => (r.start_date < m ? r.start_date : m), '9999');
    const projectEnd = all.reduce((m, r) => (r.end_date > m ? r.end_date : m), '');
    const chainStart = marked.reduce((m, r) => (r.start_date < m ? r.start_date : m), '9999');

    const projectSpan = toTime(projectEnd) - toTime(projectStart);
    const chainSpan = toTime(projectEnd) - toTime(chainStart);
    expect(projectSpan).toBeGreaterThan(0);
    // Với lỗi nút gộp, tỷ lệ này tụt xuống khoảng 0,15 trên dev.db.
    expect(chainSpan / projectSpan).toBeGreaterThan(0.5);
  });

  /**
   * Cả điểm của phương án (b) PM chốt: chuỗi phải KHÁC đường găng pha A.
   *
   * Giống hệt nhau nghĩa là cạnh do người không đóng góp gì, và §7.2 gọi chênh lệch giữa
   * hai pha là "chi phí do thiếu người" — không có chênh lệch thì không có con số đó.
   */
  it('khác đường găng pha A — cạnh do người có đóng góp', () => {
    const all = rows('P-MAIN');
    const onlyResource = all.filter((r) => r.is_critical === 0 && r.is_resource_critical === 1);
    expect(onlyResource.length).toBeGreaterThan(0);
  });

  /**
   * M2: cùng INPUT ra cùng OUTPUT. Dựng hai DB sạch giống hệt nhau rồi so kết quả.
   *
   * Bản đầu của bài này viết kiểu xếp-lại-hai-lần-trên-một-DB và nó đỏ. Lúc đó tôi kết
   * luận là "input khác thì output khác, đúng thôi" rồi đổi bài đi cho xanh. Kết luận đó
   * SAI, và nó là lý do một lỗi thật sống sót nhiều tháng: trong một lượt "Recalculate
   * all", lịch cũ của P-SIDE là output của lượt trước chứ không phải chỗ đã bị chiếm
   * thật, nên P-MAIN không được phép né nó. Xem bài ngay dưới.
   *
   * Bài này vẫn giữ nguyên — hai DB sạch là cách đo M2 đúng nhất — nhưng nó KHÔNG còn
   * gánh một mình: một bài xanh vì đã tránh chỗ đau thì không phải bằng chứng.
   */
  it('tất định — hai DB sạch giống hệt cho cùng kết quả (N2, M2)', () => {
    const build = (): Db => {
      const fresh = openDatabase(':memory:');
      migrate(fresh, SCENARIO_AT);
      buildScenario(fresh, {
        primaryPayload: JSON.parse(readFileSync(join(FIXTURES, 'wbs-500.json'), 'utf8')),
        secondaryPayload: buildPayload(100, 'GEO'),
      });
      scheduleAllProjects(fresh, { runId: 'X', now: SCENARIO_AT, windowDays: 2000 });
      return fresh;
    };
    const snap = (x: Db): string[] =>
      (
        x
          .prepare(
            `SELECT t.uid, s.start_date, s.end_date, s.is_resource_critical
               FROM task t JOIN schedule s ON s.task_uid = t.uid
              WHERE t.project_id = 'P-MAIN' ORDER BY t.uid`,
          )
          .all() as Array<Record<string, unknown>>
      ).map(
        (r) =>
          `${String(r['uid'])} ${String(r['start_date'])} ${String(r['is_resource_critical'])}`,
      );

    const one = build();
    const two = build();
    try {
      expect(snap(two)).toEqual(snap(one));
    } finally {
      one.close();
      two.close();
    }
  });

  /**
   * "Recalculate all" chạy lại trên dữ liệu y nguyên phải cho ĐÚNG kết quả cũ.
   *
   * Đây là bài bắt được lỗi mà `cross-project.test.ts` không bắt nổi: ở đó hai dự án nhỏ
   * dùng chung MỘT người, dự án ưu tiên 1 lấy được khoảng sớm nhất ngay lượt đầu nên lượt
   * sau nó lấy lại đúng chỗ đó — xanh vì may. Fixture ở đây có 500 + 100 task, nhiều
   * người và nhiều role, nên một khác biệt nhỏ ở lượt trước đủ để đổi cả RESOURCE_KEY của
   * lượt sau. Trước khi sửa, ba lượt liên tiếp ra ba kết quả khác nhau và không bao giờ
   * dừng lại.
   *
   * Ba lượt chứ không phải hai: hai lượt chỉ chứng minh "có đổi", ba lượt chứng minh nó
   * KHÔNG hội tụ về đâu cả.
   */
  it('chạy Recalculate all ba lượt trên cùng DB cho kết quả y hệt (M2)', () => {
    const snap = (): string =>
      JSON.stringify(
        db.prepare('SELECT task_uid, start_date, end_date FROM schedule ORDER BY task_uid').all(),
      );

    const run = (): string => {
      scheduleAllProjects(db, { runId: 'RPT', now: SCENARIO_AT, windowDays: 2000 });
      return snap();
    };

    const first = run();
    expect(run(), 'lượt 2 phải bằng lượt 1').toBe(first);
    expect(run(), 'lượt 3 phải bằng lượt 1').toBe(first);
  });
});
