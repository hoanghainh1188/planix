import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { ResourcePool } from './resource-pool.js';
import { addDays, unsafeDateOnly as d } from './date-only.js';

const SNAP: CalendarSnapshot = {
  calendars: [{ id: 'CAL', scope: 'location', parentId: null, weekPattern: '1111100' }],
  exceptions: [],
  locations: [{ id: 'VN', calendarId: 'CAL' }],
  resources: [
    {
      id: 'R-1',
      locationId: 'VN',
      calendarId: null,
      dailyCapacity: 1,
      availableFrom: null,
      availableTo: null,
    },
    {
      id: 'R-2',
      locationId: 'VN',
      calendarId: null,
      dailyCapacity: 0.5,
      availableFrom: null,
      availableTo: null,
    },
  ],
};

const MON = d('2026-05-04'); // thu Hai
const SAT = d('2026-05-09');

function pool() {
  return new ResourcePool(createCalendarEngine(SNAP), ['R-1', 'R-2'], MON, 60);
}

describe('ResourcePool — capacity còn lại', () => {
  it('ban đầu bằng capacity của lịch', () => {
    const p = pool();
    expect(p.remaining('R-1', MON)).toBe(1);
    expect(p.remaining('R-2', MON)).toBe(0.5);
    expect(p.remaining('R-1', SAT)).toBe(0);
  });

  it('đặt chỗ thì trừ đi, giải phóng thì cộng lại', () => {
    const p = pool();
    p.reserve('R-1', MON, MON, 0.25);
    expect(p.remaining('R-1', MON)).toBe(0.75);
    p.release('R-1', MON, MON, 0.25);
    expect(p.remaining('R-1', MON)).toBe(1);
  });

  it('đặt chỗ một khoảng ngày', () => {
    const p = pool();
    const wed = addDays(MON, 2);
    p.reserve('R-1', MON, wed, 0.5);
    expect(p.remaining('R-1', MON)).toBe(0.5);
    expect(p.remaining('R-1', wed)).toBe(0.5);
    expect(p.remaining('R-1', addDays(MON, 3))).toBe(1);
  });

  it('đếm số task song song', () => {
    const p = pool();
    expect(p.parallelOn('R-1', MON)).toBe(0);
    p.reserve('R-1', MON, MON, 0.25);
    p.reserve('R-1', MON, MON, 0.25);
    expect(p.parallelOn('R-1', MON)).toBe(2);
  });

  it('ngày ngoài cửa sổ trả 0, không ném lỗi', () => {
    const p = pool();
    expect(p.remaining('R-1', d('2020-01-01'))).toBe(0);
    expect(p.remaining('R-1', d('2030-01-01'))).toBe(0);
  });

  it('resource lạ thì ném lỗi thay vì trả 0 im lặng', () => {
    expect(() => pool().remaining('KHONG-CO', MON)).toThrow(/KHONG-CO/);
  });
});

describe('ResourcePool — tìm chỗ trống', () => {
  it('bỏ qua cuối tuần khi tìm ngày đủ chỗ', () => {
    const p = pool();
    // T6 08/05 con trong; ngay tiep theo co cho la T2 11/05
    expect(p.firstDayWithRoom('R-1', SAT, 1, 2)).toBe('2026-05-11');
  });

  it('bỏ qua ngày đã kín', () => {
    const p = pool();
    p.reserve('R-1', MON, MON, 1);
    expect(p.firstDayWithRoom('R-1', MON, 1, 2)).toBe('2026-05-05');
  });

  it('tôn trọng max_parallel: ngày đã đủ số task song song thì bỏ qua', () => {
    const p = pool();
    p.reserve('R-1', MON, MON, 0.25);
    p.reserve('R-1', MON, MON, 0.25);
    // con 0.5 capacity nhung da 2 task -> max_parallel 2 chan lai
    expect(p.firstDayWithRoom('R-1', MON, 0.25, 2)).toBe('2026-05-05');
    // neu cho phep 3 song song thi van dung ngay do
    expect(p.firstDayWithRoom('R-1', MON, 0.25, 3)).toBe('2026-05-04');
  });

  it('người nửa ngày không nhận nổi allocation 1.0', () => {
    const p = pool();
    expect(p.firstDayWithRoom('R-2', MON, 0.5, 2)).toBe('2026-05-04');
    expect(p.firstDayWithRoom('R-2', MON, 1, 2)).toBeNull();
  });

  it('hết cửa sổ mà không thấy chỗ thì trả null, không chạy mãi', () => {
    const p = pool();
    p.reserve('R-1', MON, addDays(MON, 59), 1);
    expect(p.firstDayWithRoom('R-1', MON, 1, 2)).toBeNull();
  });
});

describe('ResourcePool — tổng MD đã gán (RESOURCE_KEY bậc 3)', () => {
  it('cộng dồn theo allocation × số ngày làm', () => {
    const p = pool();
    expect(p.assignedMd('R-1')).toBe(0);
    p.reserve('R-1', MON, addDays(MON, 1), 0.5); // 2 ngay lam x 0.5
    expect(p.assignedMd('R-1')).toBe(1);
  });

  it('không tính ngày nghỉ', () => {
    const p = pool();
    p.reserve('R-1', SAT, SAT, 1); // thu Bay
    expect(p.assignedMd('R-1')).toBe(0);
  });
});
