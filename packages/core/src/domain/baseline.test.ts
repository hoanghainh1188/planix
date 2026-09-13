import { describe, expect, it } from 'vitest';
import { buildBaselineSnapshot, diffBaseline, type BaselineTask } from './baseline.js';
import { unsafeDateOnly as d } from './date-only.js';

function t(uid: string, over: Partial<BaselineTask> = {}): BaselineTask {
  return {
    uid,
    wbsCode: '1',
    name: uid,
    effortMd: 2,
    startDate: d('2026-05-04'),
    endDate: d('2026-05-05'),
    status: 'not_started',
    percent: 0,
    ...over,
  };
}

describe('buildBaselineSnapshot — tái lập được (M2)', () => {
  it('cùng dữ liệu cho cùng chuỗi, bất kể thứ tự mảng vào', () => {
    const tasks = [t('T-2', { wbsCode: '2' }), t('T-1')];
    expect(buildBaselineSnapshot(tasks, '2026-05-11')).toBe(
      buildBaselineSnapshot([...tasks].reverse(), '2026-05-11'),
    );
  });

  it('giữ status_date của kỳ chốt', () => {
    const json: unknown = JSON.parse(buildBaselineSnapshot([t('T-1')], '2026-05-11'));
    expect((json as { statusDate: string }).statusDate).toBe('2026-05-11');
  });
});

describe('diffBaseline — §12.1 wbs_diff_baseline', () => {
  const base = [t('T-1'), t('T-2', { wbsCode: '2' })];

  it('task thêm mới', () => {
    const diff = diffBaseline(base, [...base, t('T-3', { wbsCode: '3' })]);
    expect(diff.added).toEqual(['T-3']);
    expect(diff.removed).toEqual([]);
  });

  it('task bị xoá', () => {
    const diff = diffBaseline(base, [t('T-1')]);
    expect(diff.removed).toEqual(['T-2']);
  });

  it('MD đổi', () => {
    const diff = diffBaseline(base, [t('T-1', { effortMd: 5 }), base[1]!]);
    expect(diff.effortChanged).toEqual([{ uid: 'T-1', from: 2, to: 5, delta: 3 }]);
  });

  it('ngày kết thúc trượt, tính theo số ngày lịch', () => {
    const diff = diffBaseline(base, [t('T-1', { endDate: d('2026-05-08') }), base[1]!]);
    expect(diff.slipped).toEqual([{ uid: 'T-1', from: '2026-05-05', to: '2026-05-08', days: 3 }]);
  });

  it('về sớm hơn baseline thì days âm', () => {
    const diff = diffBaseline(base, [t('T-1', { endDate: d('2026-05-04') }), base[1]!]);
    expect(diff.slipped[0]?.days).toBe(-1);
  });

  it('không đổi gì thì mọi mục rỗng', () => {
    const diff = diffBaseline(base, base);
    expect(diff).toMatchObject({ added: [], removed: [], effortChanged: [], slipped: [] });
  });

  it('tổng MD thêm vào cho biết scope creep so với mốc cam kết (§7.13)', () => {
    const diff = diffBaseline(base, [...base, t('T-3', { wbsCode: '3', effortMd: 8 })]);
    expect(diff.addedEffortMd).toBe(8);
  });

  it('kết quả sắp theo uid, không phụ thuộc thứ tự vào (N2)', () => {
    const current = [t('T-9', { wbsCode: '9' }), t('T-3', { wbsCode: '3' }), ...base];
    expect(diffBaseline(base, current).added).toEqual(['T-3', 'T-9']);
    expect(diffBaseline(base, [...current].reverse()).added).toEqual(['T-3', 'T-9']);
  });
});
