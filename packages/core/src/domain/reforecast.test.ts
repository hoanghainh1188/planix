import { describe, expect, it } from 'vitest';
import { reforecast, type ReforecastTask } from './reforecast.js';
import { unsafeDateOnly as d } from './date-only.js';

const STATUS_DATE = d('2026-05-11');

function t(uid: string, over: Partial<ReforecastTask> = {}): ReforecastTask {
  return {
    uid,
    effortMd: 10,
    status: 'not_started',
    percent: 0,
    remainingMd: null,
    actualStart: null,
    actualEnd: null,
    ...over,
  };
}

const plan = (tasks: ReforecastTask[]) => reforecast(tasks, STATUS_DATE);

describe('reforecast — bảng §7.11', () => {
  it('done: cố định ngày thật, không tính lại', () => {
    const r = plan([
      t('A', {
        status: 'done',
        percent: 100,
        actualStart: d('2026-05-04'),
        actualEnd: d('2026-05-06'),
      }),
    ]);
    expect(r.get('A')).toMatchObject({
      mode: 'fixed',
      remainingMd: 0,
      fixedStart: '2026-05-04',
      fixedEnd: '2026-05-06',
    });
  });

  it('in_progress: cố định actual_start, phần còn lại tính TỪ status_date', () => {
    const r = plan([t('A', { status: 'in_progress', percent: 40, actualStart: d('2026-05-04') })]);
    expect(r.get('A')).toMatchObject({
      mode: 'partial',
      fixedStart: '2026-05-04',
      earliestStart: '2026-05-11',
      remainingMd: 6,
    });
  });

  it('blocked: xử lý như in_progress nhưng kèm issue Major', () => {
    const r = plan([t('A', { status: 'blocked', percent: 20, actualStart: d('2026-05-04') })]);
    expect(r.get('A')?.mode).toBe('partial');
    expect(r.issues.some((i) => i.severity === 'Major' && i.taskUid === 'A')).toBe(true);
  });

  it('cancelled: loại khỏi lịch', () => {
    const r = plan([t('A', { status: 'cancelled' })]);
    expect(r.get('A')?.mode).toBe('excluded');
  });

  it('not_started: lập lịch bình thường, không sớm hơn status_date', () => {
    const r = plan([t('A')]);
    expect(r.get('A')).toMatchObject({
      mode: 'fresh',
      earliestStart: '2026-05-11',
      remainingMd: 10,
    });
  });
});

describe('reforecast — remaining_md (§7.11)', () => {
  it('ưu tiên remaining_md nhập tay hơn suy từ percent', () => {
    const r = plan([
      t('A', { status: 'in_progress', percent: 80, remainingMd: 5, actualStart: d('2026-05-04') }),
    ]);
    // Suy tu percent se ra 2, nhung nguoi nhap noi con 5.
    expect(r.get('A')?.remainingMd).toBe(5);
  });

  it('không nhập tay thì suy từ percent', () => {
    const r = plan([t('A', { status: 'in_progress', percent: 80, actualStart: d('2026-05-04') })]);
    expect(r.get('A')?.remainingMd).toBeCloseTo(2, 6);
  });

  it('remaining_md = 0 nhập tay vẫn được tôn trọng, không bị coi là chưa nhập', () => {
    const r = plan([
      t('A', { status: 'in_progress', percent: 10, remainingMd: 0, actualStart: d('2026-05-04') }),
    ]);
    expect(r.get('A')?.remainingMd).toBe(0);
  });
});

describe('reforecast — dữ liệu mâu thuẫn thì báo, không tự sửa (N4)', () => {
  it('done mà thiếu actual_start thì báo C11 và vẫn cố định phần có', () => {
    const r = plan([t('A', { status: 'done', percent: 100, actualEnd: d('2026-05-06') })]);
    expect(r.issues.some((i) => i.code === 'C11')).toBe(true);
  });

  it('in_progress mà thiếu actual_start thì báo, không tự bịa ngày', () => {
    const r = plan([t('A', { status: 'in_progress', percent: 30 })]);
    expect(r.issues.some((i) => i.taskUid === 'A')).toBe(true);
    expect(r.get('A')?.fixedStart).toBeNull();
  });

  it('percent > 0 nhưng status not_started thì báo J10 (§8.2)', () => {
    const r = plan([t('A', { percent: 30 })]);
    expect(r.issues.some((i) => i.code === 'J10')).toBe(true);
  });

  it('done nhưng percent < 100 thì báo J12 (§8.2)', () => {
    const r = plan([
      t('A', {
        status: 'done',
        percent: 80,
        actualStart: d('2026-05-04'),
        actualEnd: d('2026-05-06'),
      }),
    ]);
    expect(r.issues.some((i) => i.code === 'J12')).toBe(true);
  });
});

describe('reforecast — engine KHÔNG BAO GIỜ ghi vào progress (§7.11)', () => {
  it('dữ liệu vào không bị sửa', () => {
    const input = [t('A', { status: 'in_progress', percent: 40, actualStart: d('2026-05-04') })];
    const snapshot = JSON.stringify(input);
    plan(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
