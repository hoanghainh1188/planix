import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeekMon0,
  fromEpochDay,
  toEpochDay,
  unsafeDateOnly as d,
} from './date-only.js';

describe('toEpochDay / fromEpochDay', () => {
  it('mốc epoch', () => {
    expect(toEpochDay(d('1970-01-01'))).toBe(0);
    expect(fromEpochDay(0)).toBe('1970-01-01');
  });

  it('khứ hồi đúng qua nhiều mốc khó', () => {
    for (const s of [
      '1900-01-01',
      '1900-03-01',
      '2000-02-29',
      '2024-02-29',
      '2026-09-13',
      '2027-12-31',
      '2100-03-01',
    ]) {
      expect(fromEpochDay(toEpochDay(d(s)))).toBe(s);
    }
  });

  it('ngày trước epoch cho số âm', () => {
    expect(toEpochDay(d('1969-12-31'))).toBe(-1);
    expect(fromEpochDay(-1)).toBe('1969-12-31');
  });
});

describe('addDays', () => {
  it('vượt mốc tháng, năm và năm nhuận', () => {
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
  });
});

describe('dayOfWeekMon0 — gốc thứ Hai để khớp week_pattern (§4.2)', () => {
  it('1970-01-01 là thứ Năm', () => {
    expect(dayOfWeekMon0(d('1970-01-01'))).toBe(3);
  });

  it('một tuần liên tiếp chạy đủ 0..6', () => {
    // 2026-09-14 la thu Hai.
    const got = [0, 1, 2, 3, 4, 5, 6].map((i) => dayOfWeekMon0(addDays(d('2026-09-14'), i)));
    expect(got).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('không bao giờ trả số âm, kể cả trước epoch', () => {
    for (let i = 0; i < 14; i++) {
      const v = dayOfWeekMon0(addDays(d('1960-01-01'), i));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});
