import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importHolidays, loadCalendarSnapshot } from '../../src/db/repo/calendar-repo.js';
import { createCalendarEngine } from '../../src/domain/calendar.js';
import { parseHolidayCsv } from '../../src/io/holiday-csv.js';
import { unsafeDateOnly as d } from '../../src/domain/date-only.js';

const AT = '2026-09-13T00:00:00.000Z';
const CSV = ['2026/1/1,元日', '2026/5/3,憲法記念日', '2026/5/6,休日', '2027/1/1,元日'].join('\n');

let db: Db;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','Japan','Asia/Tokyo','CAL-JP')`,
  ).run();
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-jp','BrSE','JP')`).run();
});
afterEach(() => db.close());

describe('importHolidays', () => {
  it('nạp lễ của đúng một năm', () => {
    const entries = parseHolidayCsv(CSV, { years: [2026] });
    const res = importHolidays(db, { calendarId: 'CAL-JP', year: 2026, entries });
    expect(res).toEqual({ removed: 0, inserted: 3 });
  });

  it('chạy lại thì THAY THẾ chứ không chèn thêm', () => {
    const entries = parseHolidayCsv(CSV, { years: [2026] });
    importHolidays(db, { calendarId: 'CAL-JP', year: 2026, entries });
    const second = importHolidays(db, { calendarId: 'CAL-JP', year: 2026, entries });
    expect(second).toEqual({ removed: 3, inserted: 3 });

    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM calendar_exception WHERE kind='holiday'`)
      .get() as { n: number };
    expect(row.n).toBe(3);
  });

  it('nạp năm 2027 không xoá lễ năm 2026', () => {
    importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2026,
      entries: parseHolidayCsv(CSV, { years: [2026] }),
    });
    importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2027,
      entries: parseHolidayCsv(CSV, { years: [2027] }),
    });
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM calendar_exception WHERE kind='holiday'`)
      .get() as { n: number };
    expect(row.n).toBe(4);
  });

  it('KHÔNG xoá lây nghỉ phép cá nhân', () => {
    db.prepare(
      `INSERT INTO calendar_exception (calendar_id,date_from,date_to,capacity,kind)
       VALUES ('CAL-JP','2026-03-02','2026-03-02',0,'leave')`,
    ).run();
    importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2026,
      entries: parseHolidayCsv(CSV, { years: [2026] }),
    });
    importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2026,
      entries: parseHolidayCsv(CSV, { years: [2026] }),
    });
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM calendar_exception WHERE kind='leave'`)
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('từ chối entry lệch năm thay vì ghi nhầm', () => {
    expect(() =>
      importHolidays(db, { calendarId: 'CAL-JP', year: 2026, entries: parseHolidayCsv(CSV) }),
    ).toThrow(/2027/);
  });
});

describe('loadCalendarSnapshot — nối repo với engine', () => {
  it('lễ nạp từ CSV làm engine trả capacity 0 đúng ngày đó', () => {
    importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2026,
      entries: parseHolidayCsv(CSV, { years: [2026] }),
    });
    const engine = createCalendarEngine(loadCalendarSnapshot(db));

    // 2026-05-06 la 振替休日 lay tu nguon chinh thuc, khong tu tinh.
    expect(engine.capacityOn('R-jp', d('2026-05-06'))).toBe(0);
    expect(engine.capacityOn('R-jp', d('2026-05-07'))).toBe(1);
    expect(engine.isWorkingAtLocation('JP', d('2026-01-01'))).toBe(false);
  });
});
