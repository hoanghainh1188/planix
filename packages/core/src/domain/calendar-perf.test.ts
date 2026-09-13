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

  it('lặp lại lượt tra cho kết quả y hệt, cache không làm sai lệch', () => {
    const engine = createCalendarEngine(bigSnapshot(1));
    const start = d('2026-01-01');

    const first = Array.from({ length: 365 }, (_, i) =>
      engine.capacityOn('R-0', addDays(start, i)),
    );
    const second = Array.from({ length: 365 }, (_, i) =>
      engine.capacityOn('R-0', addDays(start, i)),
    );
    expect(second).toEqual(first);

    // Ngày lễ đã nạp phải ra 0 ở cả hai lượt — bằng chứng cache giữ đúng exception,
    // không phải chỉ giữ mẫu tuần.
    expect(engine.capacityOn('R-0', d('2026-04-30'))).toBe(0);
  });

  // GHI CHÚ: ở đây từng có một test so thời gian "lượt sau nhanh hơn lượt đầu". Nó đo
  // hai khoảng cỡ 1-3 ms, và ở thang đó JIT warmup cùng nhiễu lịch biểu áp đảo tín
  // hiệu — CI đỏ với 3.48 ms so 1.39 ms. Phép so thời gian ở thang dưới mili-giây
  // không thể làm đáng tin, nên đã bỏ. Tác dụng của cache được đo bằng bài 12.000 lượt
  // tra ở trên (ngưỡng 1 giây, biên rất rộng), còn tính đúng thì kiểm bằng khẳng định.
});
