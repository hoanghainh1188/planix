import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { addDays, unsafeDateOnly as d } from './date-only.js';

/**
 * §5.6: "Không cache thì 6.000 task × 30 người × 400 ngày là không chạy nổi."
 * §14.2 P2 đặt ngưỡng 1 giây. Đây là tải đúng theo con số spec nêu.
 */
function bigSnapshot(resourceCount: number): CalendarSnapshot {
  const calendars = [
    { id: 'CAL-VN', scope: 'location' as const, parentId: null, weekPattern: '1111100' },
  ];
  const exceptions = [];
  // Rai le rai rac 3 nam, giong lich le that.
  for (let y = 2026; y <= 2028; y++) {
    for (const md of ['01-01', '04-30', '05-01', '09-02']) {
      const day = d(`${y}-${md}`);
      exceptions.push({
        calendarId: 'CAL-VN',
        dateFrom: day,
        dateTo: day,
        capacity: 0,
        kind: 'holiday' as const,
      });
    }
  }
  return {
    calendars,
    exceptions,
    locations: [{ id: 'VN', calendarId: 'CAL-VN' }],
    resources: Array.from({ length: resourceCount }, (_, i) => ({
      id: `R-${i}`,
      locationId: 'VN',
      calendarId: null,
      dailyCapacity: 1,
      availableFrom: null,
      availableTo: null,
    })),
  };
}

describe('hiệu năng calendar (§14.2 P2)', () => {
  it('30 người × 400 ngày tra capacity dưới 1 giây', () => {
    const engine = createCalendarEngine(bigSnapshot(30));
    const start = d('2026-01-01');

    const t0 = performance.now();
    let total = 0;
    for (let r = 0; r < 30; r++) {
      for (let day = 0; day < 400; day++) {
        total += engine.capacityOn(`R-${r}`, addDays(start, day));
      }
    }
    const elapsed = performance.now() - t0;

    console.info(`capacityOn 30 x 400 = 12.000 lượt tra: ${elapsed.toFixed(0)} ms`);
    expect(total).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it('cache thật sự có tác dụng: lượt sau nhanh hơn lượt đầu', () => {
    const engine = createCalendarEngine(bigSnapshot(1));
    const start = d('2026-01-01');

    const t0 = performance.now();
    for (let i = 0; i < 365; i++) engine.capacityOn('R-0', addDays(start, i));
    const cold = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 365; i++) engine.capacityOn('R-0', addDays(start, i));
    const warm = performance.now() - t1;

    console.info(`lượt đầu ${cold.toFixed(2)} ms, lượt sau ${warm.toFixed(2)} ms`);
    // Lươt đầu phải dựng bảng cả năm; lượt sau chỉ tra chỉ số.
    expect(warm).toBeLessThanOrEqual(cold);
  });
});
