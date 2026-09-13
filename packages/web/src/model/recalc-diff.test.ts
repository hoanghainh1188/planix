import { describe, expect, it } from 'vitest';
import { buildRecalcDiff, type ScheduleSnapshotRow } from './recalc-diff.js';

function row(
  taskUid: string,
  projectId: string,
  endDate: string | null,
  over: Partial<ScheduleSnapshotRow> = {},
): ScheduleSnapshotRow {
  return {
    taskUid,
    projectId,
    wbsCode: '1',
    name: taskUid,
    startDate: '2026-01-05',
    endDate,
    ...over,
  };
}

describe('buildRecalcDiff (§10.1)', () => {
  it('không đổi gì thì bảng rỗng', () => {
    const rows = [row('T-1', 'P-A', '2026-02-01')];
    const diff = buildRecalcDiff(rows, rows, 'P-A');
    expect(diff.projects).toEqual([]);
    expect(diff.totalSlipped).toBe(0);
  });

  it('task trượt muộn thì ghi số ngày dương', () => {
    const diff = buildRecalcDiff(
      [row('T-1', 'P-A', '2026-02-01')],
      [row('T-1', 'P-A', '2026-02-05')],
      'P-A',
    );
    expect(diff.projects[0]?.slipped[0]).toMatchObject({ taskUid: 'T-1', days: 4 });
  });

  it('về sớm hơn thì số ngày âm', () => {
    const diff = buildRecalcDiff(
      [row('T-1', 'P-A', '2026-02-05')],
      [row('T-1', 'P-A', '2026-02-01')],
      'P-A',
    );
    expect(diff.projects[0]?.slipped[0]?.days).toBe(-4);
  });

  it('trượt NHIỀU NHẤT lên đầu — PM thấy thiệt hại lớn nhất trước', () => {
    const before = [row('T-nho', 'P-A', '2026-02-01'), row('T-lon', 'P-A', '2026-02-01')];
    const after = [row('T-nho', 'P-A', '2026-02-02'), row('T-lon', 'P-A', '2026-03-01')];
    const diff = buildRecalcDiff(before, after, 'P-A');
    expect(diff.projects[0]?.slipped.map((s) => s.taskUid)).toEqual(['T-lon', 'T-nho']);
  });

  it('ghi ngày kết thúc dự án đổi bao nhiêu', () => {
    const diff = buildRecalcDiff(
      [row('T-1', 'P-A', '2026-02-01'), row('T-2', 'P-A', '2026-03-01')],
      [row('T-1', 'P-A', '2026-02-01'), row('T-2', 'P-A', '2026-03-11')],
      'P-A',
    );
    expect(diff.projects[0]).toMatchObject({
      endBefore: '2026-03-01',
      endAfter: '2026-03-11',
      endShiftDays: 10,
    });
  });

  it('task thêm mới và bị xoá đều được nêu', () => {
    const diff = buildRecalcDiff(
      [row('T-cu', 'P-A', '2026-02-01')],
      [row('T-moi', 'P-A', '2026-02-01')],
      'P-A',
    );
    expect(diff.projects[0]?.added).toEqual(['T-moi']);
    expect(diff.projects[0]?.removed).toEqual(['T-cu']);
  });
});

describe('§14.2 P8 — gộp MỌI dự án bị ảnh hưởng (rủi ro R9)', () => {
  const before = [row('A-1', 'P-A', '2026-02-01'), row('B-1', 'P-B', '2026-02-01')];
  const after = [row('A-1', 'P-A', '2026-02-01'), row('B-1', 'P-B', '2026-03-01')];

  it('dự án KHÁC bị ảnh hưởng vẫn xuất hiện trong bảng', () => {
    const diff = buildRecalcDiff(before, after, 'P-A');
    expect(diff.projects.map((p) => p.projectId)).toEqual(['P-B']);
  });

  it('bật cờ cảnh báo khi đụng dự án ngoài dự án đang mở', () => {
    expect(buildRecalcDiff(before, after, 'P-A').touchesOtherProjects).toBe(true);
  });

  it('chỉ đụng dự án đang mở thì không bật cờ', () => {
    const diff = buildRecalcDiff(
      [row('A-1', 'P-A', '2026-02-01')],
      [row('A-1', 'P-A', '2026-03-01')],
      'P-A',
    );
    expect(diff.touchesOtherProjects).toBe(false);
  });

  it('dự án KHÔNG đổi gì thì không lọt vào bảng', () => {
    const diff = buildRecalcDiff(before, after, 'P-A');
    expect(diff.projects.some((p) => p.projectId === 'P-A')).toBe(false);
  });

  it('dự án nhiều task trượt hơn xếp lên trước', () => {
    const b = [
      row('A-1', 'P-A', '2026-02-01'),
      row('B-1', 'P-B', '2026-02-01'),
      row('B-2', 'P-B', '2026-02-01'),
    ];
    const a = [
      row('A-1', 'P-A', '2026-02-02'),
      row('B-1', 'P-B', '2026-02-02'),
      row('B-2', 'P-B', '2026-02-02'),
    ];
    expect(buildRecalcDiff(b, a, 'P-A').projects.map((p) => p.projectId)).toEqual(['P-B', 'P-A']);
  });

  it('tổng số task trượt gộp qua mọi dự án', () => {
    const b = [row('A-1', 'P-A', '2026-02-01'), row('B-1', 'P-B', '2026-02-01')];
    const a = [row('A-1', 'P-A', '2026-02-02'), row('B-1', 'P-B', '2026-02-02')];
    expect(buildRecalcDiff(b, a, 'P-A').totalSlipped).toBe(2);
  });
});
