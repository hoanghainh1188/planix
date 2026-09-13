import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { unsafeDateOnly as d } from './date-only.js';

/**
 * Bối cảnh chuẩn cho test: VN làm T2-T6, JP cũng T2-T6 nhưng lịch lễ khác.
 * Dev A ngồi VN, BrSE B ngồi JP (§5.2 ví dụ).
 */
function snapshot(over: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    calendars: [
      { id: 'CAL-VN', scope: 'location', parentId: null, weekPattern: '1111100' },
      { id: 'CAL-JP', scope: 'location', parentId: null, weekPattern: '1111100' },
    ],
    locations: [
      { id: 'VN', calendarId: 'CAL-VN' },
      { id: 'JP', calendarId: 'CAL-JP' },
    ],
    resources: [
      {
        id: 'R-dev-a',
        locationId: 'VN',
        calendarId: null,
        dailyCapacity: 1,
        availableFrom: null,
        availableTo: null,
      },
      {
        id: 'R-brse-b',
        locationId: 'JP',
        calendarId: null,
        dailyCapacity: 1,
        availableFrom: null,
        availableTo: null,
      },
    ],
    exceptions: [],
    ...over,
  };
}

// 2026-04-30 la thu Nam (le Giai phong o VN). 2026-05-02 la thu Bay.
const APR30 = d('2026-04-30');
const MAY01 = d('2026-05-01');
const SAT = d('2026-05-02');
const SUN = d('2026-05-03');
const MON = d('2026-05-04');

describe('capacityOn — mẫu tuần (§5.2 bước 1)', () => {
  it('ngày thường là 1, cuối tuần là 0', () => {
    const e = createCalendarEngine(snapshot());
    expect(e.capacityOn('R-dev-a', APR30)).toBe(1);
    expect(e.capacityOn('R-dev-a', SAT)).toBe(0);
    expect(e.capacityOn('R-dev-a', SUN)).toBe(0);
  });

  it('mẫu tuần nửa ngày thứ Bảy', () => {
    const e = createCalendarEngine(
      snapshot({
        calendars: [
          { id: 'CAL-VN', scope: 'location', parentId: null, weekPattern: '1111150' },
          { id: 'CAL-JP', scope: 'location', parentId: null, weekPattern: '1111100' },
        ],
      }),
    );
    // ky tu thu 6 la '5' -> 0.5 ngay
    expect(e.capacityOn('R-dev-a', SAT)).toBe(0.5);
  });

  it('lịch cá nhân ghi đè mẫu tuần của location', () => {
    const s = snapshot();
    const e = createCalendarEngine({
      ...s,
      calendars: [
        ...s.calendars,
        { id: 'CAL-PT', scope: 'resource', parentId: 'CAL-VN', weekPattern: '1110000' },
      ],
      resources: [{ ...s.resources[0]!, calendarId: 'CAL-PT' }, s.resources[1]!],
    });
    // T2-T4 lam, T5 nghi
    expect(e.capacityOn('R-dev-a', APR30)).toBe(0); // thu Nam
    expect(e.capacityOn('R-dev-a', MON)).toBe(1);
  });

  it('week_pattern NULL thì kế thừa hoàn toàn từ cha (§4.2)', () => {
    const s = snapshot();
    const e = createCalendarEngine({
      ...s,
      calendars: [
        ...s.calendars,
        { id: 'CAL-INHERIT', scope: 'resource', parentId: 'CAL-VN', weekPattern: null },
      ],
      resources: [{ ...s.resources[0]!, calendarId: 'CAL-INHERIT' }, s.resources[1]!],
    });
    expect(e.capacityOn('R-dev-a', APR30)).toBe(1);
    expect(e.capacityOn('R-dev-a', SAT)).toBe(0);
  });
});

describe('capacityOn — exception (§5.2 bước 2)', () => {
  const withHoliday = () =>
    snapshot({
      exceptions: [
        {
          calendarId: 'CAL-VN',
          dateFrom: APR30,
          dateTo: MAY01,
          capacity: 0,
          kind: 'holiday',
        },
      ],
    });

  it('lễ VN làm dev ở VN nghỉ, nhưng BrSE ngồi Nhật vẫn làm (§5.2 ví dụ)', () => {
    const e = createCalendarEngine(withHoliday());
    expect(e.capacityOn('R-dev-a', APR30)).toBe(0);
    expect(e.capacityOn('R-brse-b', APR30)).toBe(1);
  });

  it('exception cá nhân GHI ĐÈ exception của location', () => {
    const s = withHoliday();
    const e = createCalendarEngine({
      ...s,
      calendars: [
        ...s.calendars,
        { id: 'CAL-A', scope: 'resource', parentId: 'CAL-VN', weekPattern: null },
      ],
      resources: [{ ...s.resources[0]!, calendarId: 'CAL-A' }, s.resources[1]!],
      exceptions: [
        ...s.exceptions,
        // Lam bu dung ngay le — ca nhan thang location (§5.2 vi du).
        { calendarId: 'CAL-A', dateFrom: APR30, dateTo: APR30, capacity: 1, kind: 'overtime' },
      ],
    });
    expect(e.capacityOn('R-dev-a', APR30)).toBe(1);
  });

  it('exception phủ một khoảng ngày, không chỉ một ngày', () => {
    const e = createCalendarEngine(withHoliday());
    expect(e.capacityOn('R-dev-a', MAY01)).toBe(0);
    expect(e.capacityOn('R-dev-a', MON)).toBe(1); // ngoai khoang
  });

  it('nghỉ phép nửa ngày', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-VN', dateFrom: APR30, dateTo: APR30, capacity: 0.5, kind: 'leave' },
        ],
      }),
    );
    expect(e.capacityOn('R-dev-a', APR30)).toBe(0.5);
  });
});

describe('capacityOn — daily_capacity và khoảng khả dụng (§5.2 bước 3-4)', () => {
  it('nhân với daily_capacity', () => {
    const s = snapshot();
    const e = createCalendarEngine({
      ...s,
      resources: [{ ...s.resources[0]!, dailyCapacity: 0.5 }, s.resources[1]!],
    });
    expect(e.capacityOn('R-dev-a', APR30)).toBe(0.5);
  });

  it('ngoài [available_from, available_to] là 0, bất kể mẫu tuần', () => {
    const s = snapshot();
    const e = createCalendarEngine({
      ...s,
      resources: [{ ...s.resources[0]!, availableFrom: MAY01, availableTo: MON }, s.resources[1]!],
    });
    expect(e.capacityOn('R-dev-a', APR30)).toBe(0); // truoc available_from
    expect(e.capacityOn('R-dev-a', MAY01)).toBe(1);
    expect(e.capacityOn('R-dev-a', MON)).toBe(1);
    expect(e.capacityOn('R-dev-a', d('2026-05-05'))).toBe(0); // sau available_to
  });

  it('khoảng khả dụng thắng cả exception làm bù', () => {
    const s = snapshot();
    const e = createCalendarEngine({
      ...s,
      resources: [{ ...s.resources[0]!, availableFrom: MON, availableTo: null }, s.resources[1]!],
      exceptions: [
        { calendarId: 'CAL-VN', dateFrom: SAT, dateTo: SAT, capacity: 1, kind: 'overtime' },
      ],
    });
    expect(e.capacityOn('R-dev-a', SAT)).toBe(0);
  });

  it('resource không tồn tại thì ném lỗi, không trả 0 im lặng', () => {
    const e = createCalendarEngine(snapshot());
    expect(() => e.capacityOn('KHONG-CO', APR30)).toThrow(/KHONG-CO/);
  });
});

describe('workSlots — các ngày làm được kế tiếp (§5.6)', () => {
  it('bỏ qua cuối tuần', () => {
    const e = createCalendarEngine(snapshot());
    expect(e.workSlots('R-dev-a', d('2026-05-01'), 3)).toEqual([
      '2026-05-01',
      '2026-05-04',
      '2026-05-05',
    ]);
  });

  it('bỏ qua cả ngày lễ', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-VN', dateFrom: MON, dateTo: MON, capacity: 0, kind: 'holiday' },
        ],
      }),
    );
    expect(e.workSlots('R-dev-a', d('2026-05-01'), 2)).toEqual(['2026-05-01', '2026-05-05']);
  });
});

// ── Lịch B — số học ngày làm việc (§5.6, §14.2 P2) ──────────────────────────

describe('lịch B — isWorking / nextWorkingDay', () => {
  const e = () => createCalendarEngine(snapshot());

  it('isWorking theo mẫu tuần', () => {
    expect(e().isWorking('CAL-VN', APR30)).toBe(true);
    expect(e().isWorking('CAL-VN', SAT)).toBe(false);
  });

  it('nextWorkingDay nhảy qua cuối tuần', () => {
    expect(e().nextWorkingDay('CAL-VN', SAT)).toBe('2026-05-04');
  });

  it('nextWorkingDay trả chính ngày đó nếu đã là ngày làm', () => {
    expect(e().nextWorkingDay('CAL-VN', MON)).toBe('2026-05-04');
  });
});

describe('addWorkingDays (§14.2 P2: lag âm, lag lẻ 0.5, qua lễ)', () => {
  const e = () => createCalendarEngine(snapshot());

  it('cộng 0 giữ nguyên ngày', () => {
    expect(e().addWorkingDays('CAL-VN', MON, 0)).toBe('2026-05-04');
  });

  it('cộng nguyên ngày, nhảy qua cuối tuần', () => {
    // T6 01/05 + 1 ngay lam viec -> T2 04/05
    expect(e().addWorkingDays('CAL-VN', MAY01, 1)).toBe('2026-05-04');
    // T2 04/05 + 5 -> T2 11/05
    expect(e().addWorkingDays('CAL-VN', MON, 5)).toBe('2026-05-11');
  });

  it('lag ÂM đi ngược, cũng nhảy qua cuối tuần', () => {
    expect(e().addWorkingDays('CAL-VN', MON, -1)).toBe('2026-05-01');
    expect(e().addWorkingDays('CAL-VN', MON, -2)).toBe('2026-04-30');
  });

  it('lag lẻ 0.5 trên lịch có nửa ngày', () => {
    const half = createCalendarEngine(
      snapshot({
        calendars: [
          { id: 'CAL-VN', scope: 'location', parentId: null, weekPattern: '1111150' },
          { id: 'CAL-JP', scope: 'location', parentId: null, weekPattern: '1111100' },
        ],
      }),
    );
    // T6 01/05 + 0.5 -> T7 02/05 (nua ngay)
    expect(half.addWorkingDays('CAL-VN', MAY01, 0.5)).toBe('2026-05-02');
  });

  it('đi qua ngày lễ thì lễ không được tính là ngày làm', () => {
    const withHoliday = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-VN', dateFrom: MON, dateTo: MON, capacity: 0, kind: 'holiday' },
        ],
      }),
    );
    // T6 01/05 + 1, ma T2 04/05 la le -> T3 05/05
    expect(withHoliday.addWorkingDays('CAL-VN', MAY01, 1)).toBe('2026-05-05');
  });
});

describe('workingDaysBetween', () => {
  const e = () => createCalendarEngine(snapshot());

  it('đếm ngày làm trong nửa khoảng [a, b)', () => {
    // T2 04/05 den T2 11/05: 5 ngay lam
    expect(e().workingDaysBetween('CAL-VN', MON, d('2026-05-11'))).toBe(5);
  });

  it('a = b thì bằng 0', () => {
    expect(e().workingDaysBetween('CAL-VN', MON, MON)).toBe(0);
  });

  it('a > b thì trả số âm', () => {
    expect(e().workingDaysBetween('CAL-VN', d('2026-05-11'), MON)).toBe(-5);
  });
});

describe('location (§5.3)', () => {
  it('isWorkingAtLocation dùng lịch lễ quốc gia của nơi đó', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-VN', dateFrom: APR30, dateTo: APR30, capacity: 0, kind: 'holiday' },
        ],
      }),
    );
    expect(e.isWorkingAtLocation('VN', APR30)).toBe(false);
    expect(e.isWorkingAtLocation('JP', APR30)).toBe(true);
  });

  it('nextWorkingDayAtLocation trả ngày làm gần nhất — dùng cho issue J08', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-JP', dateFrom: MON, dateTo: MON, capacity: 0, kind: 'holiday' },
        ],
      }),
    );
    expect(e.nextWorkingDayAtLocation('JP', MON)).toBe('2026-05-05');
  });
});

describe('cache theo (calendarId, year) — §5.6 bắt buộc', () => {
  it('gọi lặp nhiều lần vẫn ra cùng kết quả', () => {
    const e = createCalendarEngine(snapshot());
    const first = e.capacityOn('R-dev-a', APR30);
    for (let i = 0; i < 1000; i++) e.capacityOn('R-dev-a', APR30);
    expect(e.capacityOn('R-dev-a', APR30)).toBe(first);
  });

  it('cache không làm lẫn hai lịch khác nhau', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          { calendarId: 'CAL-VN', dateFrom: APR30, dateTo: APR30, capacity: 0, kind: 'holiday' },
        ],
      }),
    );
    expect(e.isWorking('CAL-VN', APR30)).toBe(false);
    expect(e.isWorking('CAL-JP', APR30)).toBe(true);
    expect(e.isWorking('CAL-VN', APR30)).toBe(false);
  });

  it('cache không làm lẫn hai năm khác nhau', () => {
    const e = createCalendarEngine(
      snapshot({
        exceptions: [
          {
            calendarId: 'CAL-VN',
            dateFrom: d('2026-04-30'),
            dateTo: d('2026-04-30'),
            capacity: 0,
            kind: 'holiday',
          },
        ],
      }),
    );
    expect(e.isWorking('CAL-VN', d('2026-04-30'))).toBe(false);
    expect(e.isWorking('CAL-VN', d('2027-04-30'))).toBe(true);
  });
});
