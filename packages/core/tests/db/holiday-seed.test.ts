import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  availableYears,
  IncompleteHolidaySeedError,
  loadSeed,
  resolveSeed,
} from '../../src/db/seed/holiday-seed.js';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importHolidays, loadCalendarSnapshot } from '../../src/db/repo/calendar-repo.js';
import { createCalendarEngine } from '../../src/domain/calendar.js';
import { addDays, dayOfWeekMon0, unsafeDateOnly as d } from '../../src/domain/date-only.js';

const SUNDAY = 6; // dayOfWeekMon0: 0 = thu Hai
const JP_YEARS = [2025, 2026, 2027];

describe('seed lịch lễ — phủ 3 năm gần nhất', () => {
  it('Nhật có đủ 3 năm', () => {
    expect(availableYears('JP')).toEqual(JP_YEARS);
  });

  it('Việt Nam có đủ 3 năm', () => {
    expect(availableYears('VN')).toEqual(JP_YEARS);
  });

  it('thêm năm mới chỉ là thả thêm file, không sửa file cũ', () => {
    // availableYears doc thu muc, nen file moi tu dong xuat hien.
    expect(availableYears('JP').length).toBeGreaterThanOrEqual(3);
  });
});

describe('seed Nhật — kiểm chéo với luật, không tin suông vào lần tải', () => {
  it.each(JP_YEARS)('năm %i có đủ các lễ ngày cố định', (year) => {
    const dates = new Set(resolveSeed('JP', year).map((e) => e.date));
    // Nhung ngay nay co dinh theo luat, nam nao cung phai co.
    for (const md of [
      '01-01',
      '02-11',
      '02-23',
      '04-29',
      '05-03',
      '05-04',
      '05-05',
      '08-11',
      '11-03',
      '11-23',
    ]) {
      expect(dates.has(d(`${year}-${md}`))).toBe(true);
    }
  });

  it.each(JP_YEARS)('năm %i: mọi 振替休日 đều đứng sau một lễ rơi vào Chủ nhật', (year) => {
    const entries = resolveSeed('JP', year);
    const holidayDates = new Set(entries.map((e) => e.date));
    const substitutes = entries.filter((e) => e.name === '振替休日');

    for (const sub of substitutes) {
      // Lui dan qua cac ngay deu la le, phai cham mot le roi vao Chu nhat.
      let cursor = addDays(sub.date, -1);
      let foundSunday = false;
      for (let i = 0; i < 5; i++) {
        if (!holidayDates.has(cursor)) break;
        if (dayOfWeekMon0(cursor) === SUNDAY) {
          foundSunday = true;
          break;
        }
        cursor = addDays(cursor, -1);
      }
      expect(foundSunday, `振替休日 ${sub.date} không đứng sau lễ Chủ nhật nào`).toBe(true);
    }
  });

  it.each(JP_YEARS)('năm %i: không có 振替休日 nào rơi vào Chủ nhật', (year) => {
    for (const e of resolveSeed('JP', year)) {
      if (e.name !== '振替休日') continue;
      expect(dayOfWeekMon0(e.date)).not.toBe(SUNDAY);
    }
  });

  it('2026-09-22 là 国民の休日 kẹp giữa hai lễ, không phải 振替休日', () => {
    const entries = resolveSeed('JP', 2026);
    const sandwiched = entries.find((e) => e.date === '2026-09-22');
    expect(sandwiched?.name).toBe('国民の休日');
    // Hai ben phai la le.
    const dates = new Set(entries.map((e) => e.date));
    expect(dates.has(d('2026-09-21'))).toBe(true);
    expect(dates.has(d('2026-09-23'))).toBe(true);
  });

  it('ngày sắp tăng dần và không trùng', () => {
    for (const year of JP_YEARS) {
      const dates = resolveSeed('JP', year).map((e) => e.date);
      expect([...dates].sort()).toEqual(dates);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });
});

describe('seed Việt Nam — chưa đủ thì KHÔNG nạp', () => {
  it('ném IncompleteHolidaySeedError, kèm danh sách còn thiếu', () => {
    expect(() => resolveSeed('VN', 2026)).toThrow(IncompleteHolidaySeedError);
    try {
      resolveSeed('VN', 2026);
    } catch (e) {
      expect((e as Error).message).toMatch(/Tết Âm lịch/);
    }
  });

  it('nạp được khi người gọi chấp nhận tường minh', () => {
    const entries = resolveSeed('VN', 2026, { allowIncomplete: true });
    expect(entries.map((e) => e.date)).toEqual([
      '2026-01-01',
      '2026-04-30',
      '2026-05-01',
      '2026-09-02',
    ]);
  });

  it('phần đã có là các ngày dương cố định theo Bộ luật Lao động', () => {
    const seed = loadSeed('VN', 2027);
    expect(seed.complete).toBe(false);
    expect(seed.pending.length).toBeGreaterThan(0);
    expect(seed.source).toMatch(/Điều 112/);
  });
});

describe('seed nối vào engine', () => {
  let db: Db;
  const AT = '2026-09-13T00:00:00.000Z';

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db, AT);
    db.prepare(
      `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
    ).run();
    db.prepare(
      `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','Japan','Asia/Tokyo','CAL-JP')`,
    ).run();
    db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R','BrSE','JP')`).run();
  });
  afterEach(() => db.close());

  it('nạp cả 3 năm rồi engine trả capacity 0 đúng ngày lễ', () => {
    for (const year of JP_YEARS) {
      importHolidays(db, { calendarId: 'CAL-JP', year, entries: resolveSeed('JP', year) });
    }
    const engine = createCalendarEngine(loadCalendarSnapshot(db));

    expect(engine.capacityOn('R', d('2026-05-06'))).toBe(0); // 振替休日
    expect(engine.capacityOn('R', d('2026-09-22'))).toBe(0); // 国民の休日
    expect(engine.capacityOn('R', d('2027-03-22'))).toBe(0); // 振替休日
    expect(engine.capacityOn('R', d('2025-11-24'))).toBe(0); // 振替休日
    // Ngay lam viec binh thuong.
    expect(engine.capacityOn('R', d('2026-05-07'))).toBe(1);
  });

  it('nạp lại một năm thì thay thế, không nhân đôi', () => {
    importHolidays(db, { calendarId: 'CAL-JP', year: 2026, entries: resolveSeed('JP', 2026) });
    const second = importHolidays(db, {
      calendarId: 'CAL-JP',
      year: 2026,
      entries: resolveSeed('JP', 2026),
    });
    expect(second.removed).toBe(second.inserted);
  });
});
