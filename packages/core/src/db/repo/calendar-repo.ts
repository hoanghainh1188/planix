/**
 * Truy vấn lịch. Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3), prepared statement.
 */

import type { Db } from '../migrate.js';
import type { HolidayEntry } from '../../io/holiday-csv.js';
import type {
  CalendarDef,
  CalendarExceptionDef,
  CalendarSnapshot,
  LocationDef,
  ResourceDef,
} from '../../domain/calendar.js';
import type { DateOnly } from '../../domain/date-only.js';

/**
 * Nạp lễ cho một lịch trong MỘT năm, thay thế toàn bộ lễ cũ của năm đó.
 *
 * Hỗ trợ lệnh §5.4: `wbs calendar import-holidays --location JP --year 2027`.
 *
 * Thay-cả-năm chứ không chèn thêm: lịch lễ Nhật do nội các quyết và có thể đổi sau khi
 * công bố. Chèn thêm sẽ để lại ngày cũ đã bị huỷ nằm lẫn trong DB, và không ai phát
 * hiện ra cho tới khi lịch tính sai.
 *
 * Chỉ đụng dòng `kind='holiday'` — nghỉ phép và làm bù của cá nhân không bị xoá lây.
 */
export function importHolidays(
  db: Db,
  params: { calendarId: string; year: number; entries: readonly HolidayEntry[] },
): { removed: number; inserted: number } {
  const { calendarId, year, entries } = params;
  const from = `${String(year).padStart(4, '0')}-01-01`;
  const to = `${String(year).padStart(4, '0')}-12-31`;

  const wrongYear = entries.find((e) => e.date < from || e.date > to);
  if (wrongYear !== undefined) {
    throw new Error(`Entry ${wrongYear.date} is outside year ${year}`);
  }

  return db.transaction(() => {
    const removed = db
      .prepare(
        `DELETE FROM calendar_exception
         WHERE calendar_id = ? AND kind = 'holiday' AND date_from >= ? AND date_to <= ?`,
      )
      .run(calendarId, from, to).changes;

    const insert = db.prepare(
      `INSERT INTO calendar_exception (calendar_id, date_from, date_to, capacity, kind, note)
       VALUES (?, ?, ?, 0, 'holiday', ?)`,
    );
    for (const e of entries) insert.run(calendarId, e.date, e.date, e.name);

    return { removed, inserted: entries.length };
  })();
}

/** Đọc toàn bộ dữ liệu lịch thành ảnh chụp cho `createCalendarEngine`. */
export function loadCalendarSnapshot(db: Db): CalendarSnapshot {
  const calendars = (
    db
      .prepare('SELECT id, scope, parent_id, week_pattern FROM calendar ORDER BY id')
      .all() as Array<Record<string, unknown>>
  ).map((r): CalendarDef => ({
    id: r['id'] as string,
    scope: r['scope'] as CalendarDef['scope'],
    parentId: (r['parent_id'] as string | null) ?? null,
    weekPattern: (r['week_pattern'] as string | null) ?? null,
  }));

  const exceptions = (
    db
      .prepare(
        `SELECT calendar_id, date_from, date_to, capacity, kind
         FROM calendar_exception ORDER BY calendar_id, date_from, id`,
      )
      .all() as Array<Record<string, unknown>>
  ).map((r): CalendarExceptionDef => ({
    calendarId: r['calendar_id'] as string,
    dateFrom: r['date_from'] as DateOnly,
    dateTo: r['date_to'] as DateOnly,
    capacity: r['capacity'] as number,
    kind: r['kind'] as CalendarExceptionDef['kind'],
  }));

  const locations = (
    db.prepare('SELECT id, calendar_id FROM location ORDER BY id').all() as Array<
      Record<string, unknown>
    >
  ).map((r): LocationDef => ({ id: r['id'] as string, calendarId: r['calendar_id'] as string }));

  const resources = (
    db
      .prepare(
        `SELECT id, location_id, calendar_id, daily_capacity, available_from, available_to
         FROM resource ORDER BY id`,
      )
      .all() as Array<Record<string, unknown>>
  ).map((r): ResourceDef => ({
    id: r['id'] as string,
    locationId: r['location_id'] as string,
    calendarId: (r['calendar_id'] as string | null) ?? null,
    dailyCapacity: r['daily_capacity'] as number,
    availableFrom: (r['available_from'] as DateOnly | null) ?? null,
    availableTo: (r['available_to'] as DateOnly | null) ?? null,
  }));

  return { calendars, exceptions, locations, resources };
}
