import { describe, expect, it } from 'vitest';
import { buildTimeline, distinct, ganttBars, type GanttRow } from './gantt-model.js';

function g(over: Partial<GanttRow> = {}): GanttRow {
  return {
    uid: 'u',
    wbsCode: '1',
    name: 'T',
    depth: 1,
    kind: 'work',
    planStart: '2026-03-02',
    planEnd: '2026-03-06',
    isCritical: false,
    pic: null,
    teamId: null,
    phase: null,
    ...over,
  };
}

describe('trục thời gian', () => {
  it('trải từ ngày sớm nhất tới ngày muộn nhất', () => {
    const t = buildTimeline([
      g({ planStart: '2026-03-10', planEnd: '2026-03-12' }),
      g({ planStart: '2026-03-02', planEnd: '2026-03-06' }),
    ]);
    expect(t.start).toBe('2026-03-02');
    expect(t.end).toBe('2026-03-12');
    expect(t.totalDays).toBe(11);
  });

  it('bỏ qua task chưa xếp lịch', () => {
    const t = buildTimeline([g({ planStart: null, planEnd: null }), g()]);
    expect(t.start).toBe('2026-03-02');
  });

  it('không có gì xếp lịch thì trả khoảng rỗng, không ném', () => {
    const t = buildTimeline([g({ planStart: null, planEnd: null })]);
    expect(t.totalDays).toBe(0);
    expect(t.ticks).toEqual([]);
  });

  it('sinh mốc theo tháng, mốc đầu là tháng của ngày bắt đầu', () => {
    const t = buildTimeline([g({ planStart: '2026-01-15', planEnd: '2026-04-20' })]);
    expect(t.ticks.length).toBeGreaterThanOrEqual(4);
    expect(t.ticks[0]?.label).toBe('2026-01');
  });
});

describe('thanh Gantt', () => {
  const timeline = buildTimeline([g({ planStart: '2026-03-02', planEnd: '2026-03-11' })]);

  it('task đầu tiên bắt đầu ở x = 0', () => {
    const [bar] = ganttBars([g({ planStart: '2026-03-02', planEnd: '2026-03-02' })], timeline, 10);
    expect(bar?.x).toBe(0);
  });

  it('bề rộng tỷ lệ với số ngày, tính CẢ ngày cuối', () => {
    // 02/03 → 06/03 là 5 ngày, mỗi ngày 10px.
    const [bar] = ganttBars([g({ planStart: '2026-03-02', planEnd: '2026-03-06' })], timeline, 10);
    expect(bar?.width).toBe(50);
  });

  it('task một ngày vẫn có bề rộng nhìn thấy được', () => {
    const [bar] = ganttBars([g({ planStart: '2026-03-05', planEnd: '2026-03-05' })], timeline, 10);
    expect(bar?.width).toBeGreaterThan(0);
  });

  it('x dịch đúng theo số ngày kể từ mốc bắt đầu', () => {
    const [bar] = ganttBars([g({ planStart: '2026-03-05', planEnd: '2026-03-06' })], timeline, 10);
    expect(bar?.x).toBe(30);
  });

  it('task chưa xếp lịch không sinh thanh', () => {
    expect(ganttBars([g({ planStart: null, planEnd: null })], timeline, 10)).toEqual([]);
  });

  it('giữ cờ critical để tô đậm (§14.2/P9)', () => {
    const [bar] = ganttBars([g({ isCritical: true })], timeline, 10);
    expect(bar?.row.isCritical).toBe(true);
  });
});

describe('danh sách giá trị lọc', () => {
  it('gom giá trị duy nhất, bỏ null, sắp xếp ổn định', () => {
    const rows = [g({ phase: 'P2' }), g({ phase: 'P1' }), g({ phase: 'P1' }), g({ phase: null })];
    expect(distinct(rows, (r) => r.phase)).toEqual(['P1', 'P2']);
  });

  it('không có giá trị nào thì trả mảng rỗng', () => {
    expect(distinct([g({ teamId: null })], (r) => r.teamId)).toEqual([]);
  });
});
