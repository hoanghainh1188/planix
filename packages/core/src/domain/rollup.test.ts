import { describe, expect, it } from 'vitest';
import { isMicroTask, normalizeMicroTask, rollupTree, type RollupTask } from './rollup.js';

function t(uid: string, over: Partial<RollupTask> = {}): RollupTask {
  return {
    uid,
    parentUid: null,
    kind: 'work',
    effortMd: 1,
    status: 'not_started',
    percent: 0,
    planStart: null,
    planEnd: null,
    ...over,
  };
}

const sum = (uid: string, over: Partial<RollupTask> = {}) =>
  t(uid, { kind: 'summary', effortMd: null, ...over });

// ── §7.7 status rollup, 5 bậc ───────────────────────────────────────────────

describe('rollup status — 5 bậc, khớp bậc nào dừng bậc đó (§7.7)', () => {
  it('bậc 1: tất cả con cancelled thì cha cancelled', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', status: 'cancelled' }),
      t('b', { parentUid: 'S', status: 'cancelled' }),
    ]);
    expect(r.get('S')?.status).toBe('cancelled');
  });

  it('bậc 2: mọi con trừ cancelled đều done thì cha done', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', status: 'done', percent: 100 }),
      t('b', { parentUid: 'S', status: 'cancelled' }),
    ]);
    expect(r.get('S')?.status).toBe('done');
  });

  it('bậc 3 THẮNG bậc 4: có con blocked thì cha blocked dù có con done', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', status: 'done', percent: 100 }),
      t('b', { parentUid: 'S', status: 'blocked' }),
    ]);
    expect(r.get('S')?.status).toBe('blocked');
  });

  it('blocked NỔI LÊN TẬN GỐC cây, không dừng ở cha trực tiếp (§7.7)', () => {
    const r = rollupTree([
      sum('root'),
      sum('mid', { parentUid: 'root' }),
      t('leaf', { parentUid: 'mid', status: 'blocked' }),
    ]);
    expect(r.get('mid')?.status).toBe('blocked');
    expect(r.get('root')?.status).toBe('blocked');
  });

  it('bậc 4: có con in_progress thì cha in_progress', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', status: 'in_progress', percent: 50 }),
      t('b', { parentUid: 'S' }),
    ]);
    expect(r.get('S')?.status).toBe('in_progress');
  });

  it('bậc 4: chỉ cần MỘT con done cũng đủ để cha thành in_progress', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', status: 'done', percent: 100 }),
      t('b', { parentUid: 'S' }),
    ]);
    expect(r.get('S')?.status).toBe('in_progress');
  });

  it('bậc 5: còn lại là not_started', () => {
    const r = rollupTree([sum('S'), t('a', { parentUid: 'S' }), t('b', { parentUid: 'S' })]);
    expect(r.get('S')?.status).toBe('not_started');
  });

  it('summary không con thì giữ not_started, không sập', () => {
    expect(rollupTree([sum('S')]).get('S')?.status).toBe('not_started');
  });

  it('status của task lá không bị đụng tới', () => {
    const r = rollupTree([sum('S'), t('a', { parentUid: 'S', status: 'blocked' })]);
    expect(r.get('a')?.status).toBe('blocked');
  });
});

// ── §7.7 percent rollup theo trọng số MD ────────────────────────────────────

describe('rollup percent — trọng số theo MD (§7.7)', () => {
  it('task nặng kéo phần trăm nhiều hơn task nhẹ', () => {
    const r = rollupTree([
      sum('S'),
      t('big', { parentUid: 'S', effortMd: 9, percent: 100, status: 'done' }),
      t('small', { parentUid: 'S', effortMd: 1, percent: 0 }),
    ]);
    expect(r.get('S')?.percent).toBe(90);
  });

  it('trung bình cộng đơn giản sẽ cho 50 — chứng minh có trọng số thật', () => {
    const r = rollupTree([
      sum('S'),
      t('big', { parentUid: 'S', effortMd: 9, percent: 100, status: 'done' }),
      t('small', { parentUid: 'S', effortMd: 1, percent: 0 }),
    ]);
    expect(r.get('S')?.percent).not.toBe(50);
  });

  it('KHÔNG tính con cancelled vào mẫu số', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', effortMd: 1, percent: 100, status: 'done' }),
      t('b', { parentUid: 'S', effortMd: 99, status: 'cancelled' }),
    ]);
    expect(r.get('S')?.percent).toBe(100);
  });

  it('mốc thuần effort 0 có trọng số 0, không kéo lệch', () => {
    const r = rollupTree([
      sum('S'),
      t('m', { parentUid: 'S', kind: 'milestone', effortMd: 0, percent: 0 }),
      t('a', { parentUid: 'S', effortMd: 2, percent: 100, status: 'done' }),
    ]);
    expect(r.get('S')?.percent).toBe(100);
  });

  it('tổng MD = 0 thì rơi về trung bình cộng đơn giản (§7.7)', () => {
    const r = rollupTree([
      sum('S'),
      t('m1', { parentUid: 'S', kind: 'milestone', effortMd: 0, percent: 100, status: 'done' }),
      t('m2', { parentUid: 'S', kind: 'milestone', effortMd: 0, percent: 0 }),
    ]);
    expect(r.get('S')?.percent).toBe(50);
  });

  it('KHÔNG làm tròn khi tính đệ quy — chỉ làm tròn lúc hiển thị (§7.7)', () => {
    const r = rollupTree([
      sum('root'),
      sum('mid', { parentUid: 'root' }),
      t('a', { parentUid: 'mid', effortMd: 1, percent: 100, status: 'done' }),
      t('b', { parentUid: 'mid', effortMd: 2, percent: 0 }),
    ]);
    // 1/3 = 33.333...
    expect(r.get('mid')?.percent).toBeCloseTo(33.3333, 3);
    expect(r.get('mid')?.percentDisplay).toBe(33.3);
  });
});

describe('rollup effort — tính lúc đọc, không lưu vào task.effort_md (§7.7)', () => {
  it('cộng dồn từ dưới lên qua nhiều cấp', () => {
    const r = rollupTree([
      sum('root'),
      sum('mid', { parentUid: 'root' }),
      t('a', { parentUid: 'mid', effortMd: 2 }),
      t('b', { parentUid: 'mid', effortMd: 3 }),
      t('c', { parentUid: 'root', effortMd: 5 }),
    ]);
    expect(r.get('mid')?.effortRollup).toBe(5);
    expect(r.get('root')?.effortRollup).toBe(10);
  });

  it('không tính con cancelled', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', effortMd: 2 }),
      t('b', { parentUid: 'S', effortMd: 8, status: 'cancelled' }),
    ]);
    expect(r.get('S')?.effortRollup).toBe(2);
  });

  it('summary có effort_md thì sinh J02 (§8.2)', () => {
    const r = rollupTree([sum('S', { effortMd: 5 }), t('a', { parentUid: 'S' })]);
    expect(r.issues.some((i) => i.code === 'J02' && i.taskUid === 'S')).toBe(true);
  });
});

// ── §7.9 micro task ─────────────────────────────────────────────────────────

describe('micro task (§7.9)', () => {
  it('ngưỡng mặc định 0.5 MD', () => {
    expect(isMicroTask({ kind: 'work', effortMd: 0.5 }, 0.5)).toBe(true);
    expect(isMicroTask({ kind: 'work', effortMd: 0.25 }, 0.5)).toBe(true);
    expect(isMicroTask({ kind: 'work', effortMd: 1 }, 0.5)).toBe(false);
  });

  it('summary không bao giờ là micro task', () => {
    expect(isMicroTask({ kind: 'summary', effortMd: null }, 0.5)).toBe(false);
  });

  it('done thì percent suy ra 100 và remaining 0', () => {
    const out = normalizeMicroTask({ effortMd: 0.5, status: 'done', percent: 42 });
    expect(out.percent).toBe(100);
    expect(out.remainingMd).toBe(0);
  });

  it('chưa done thì percent 0 và remaining bằng cả effort', () => {
    const out = normalizeMicroTask({ effortMd: 0.5, status: 'not_started', percent: 60 });
    expect(out.percent).toBe(0);
    expect(out.remainingMd).toBe(0.5);
  });

  it('percent khác 0/100 thì chuẩn hoá lại và ghi N09 (§7.9)', () => {
    const out = normalizeMicroTask({ effortMd: 0.5, status: 'not_started', percent: 60 });
    expect(out.issue?.code).toBe('N09');
    expect(out.issue?.severity).toBe('Minor');
  });

  it('percent đã đúng 0 hoặc 100 thì không sinh issue', () => {
    expect(normalizeMicroTask({ effortMd: 0.5, status: 'done', percent: 100 }).issue).toBeNull();
    expect(
      normalizeMicroTask({ effortMd: 0.5, status: 'not_started', percent: 0 }).issue,
    ).toBeNull();
  });

  it('in_progress và blocked bị chặn — micro task chỉ có 3 trạng thái (§7.9)', () => {
    expect(() => normalizeMicroTask({ effortMd: 0.5, status: 'in_progress', percent: 50 })).toThrow(
      /in_progress/,
    );
    expect(() => normalizeMicroTask({ effortMd: 0.5, status: 'blocked', percent: 0 })).toThrow(
      /blocked/,
    );
  });

  it('cancelled vẫn hợp lệ', () => {
    expect(normalizeMicroTask({ effortMd: 0.5, status: 'cancelled', percent: 0 }).percent).toBe(0);
  });
});

// ── §7.7 ngày lăn lên summary ───────────────────────────────────────────────

describe('rollup ngày — start = min(con), end = max(con) (§7.7)', () => {
  it('summary lấy ngày sớm nhất và muộn nhất của con', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', planStart: '2026-03-10', planEnd: '2026-03-12' }),
      t('b', { parentUid: 'S', planStart: '2026-02-02', planEnd: '2026-02-20' }),
      t('c', { parentUid: 'S', planStart: '2026-03-01', planEnd: '2026-04-30' }),
    ]);
    expect(r.get('S')?.planStart).toBe('2026-02-02');
    expect(r.get('S')?.planEnd).toBe('2026-04-30');
  });

  it('ngày lăn qua NHIỀU cấp, không chỉ một cấp', () => {
    const r = rollupTree([
      sum('root'),
      sum('mid', { parentUid: 'root' }),
      t('leaf', { parentUid: 'mid', planStart: '2026-05-05', planEnd: '2026-05-09' }),
    ]);
    expect(r.get('root')?.planStart).toBe('2026-05-05');
    expect(r.get('root')?.planEnd).toBe('2026-05-09');
  });

  it('con chưa xếp lịch (ngày null) bị bỏ qua, không kéo summary về null', () => {
    const r = rollupTree([
      sum('S'),
      t('a', { parentUid: 'S', planStart: null, planEnd: null }),
      t('b', { parentUid: 'S', planStart: '2026-06-01', planEnd: '2026-06-03' }),
    ]);
    expect(r.get('S')?.planStart).toBe('2026-06-01');
    expect(r.get('S')?.planEnd).toBe('2026-06-03');
  });

  it('không con nào có ngày thì summary cũng null, không phải chuỗi rỗng', () => {
    const r = rollupTree([sum('S'), t('a', { parentUid: 'S' })]);
    expect(r.get('S')?.planStart).toBeNull();
    expect(r.get('S')?.planEnd).toBeNull();
  });

  it('con cancelled KHÔNG kéo dài thanh của summary', () => {
    // Task huỷ bị gỡ khỏi mạng lưới (§7) nên thường đã không có ngày; loại nó tường minh
    // để một hàng dữ liệu cũ còn sót ngày không làm phình summary.
    const r = rollupTree([
      sum('S'),
      t('a', {
        parentUid: 'S',
        planStart: '2026-01-05',
        planEnd: '2026-12-31',
        status: 'cancelled',
      }),
      t('b', { parentUid: 'S', planStart: '2026-06-01', planEnd: '2026-06-03' }),
    ]);
    expect(r.get('S')?.planStart).toBe('2026-06-01');
    expect(r.get('S')?.planEnd).toBe('2026-06-03');
  });

  it('lá giữ nguyên ngày của chính nó', () => {
    const r = rollupTree([t('x', { planStart: '2026-07-07', planEnd: '2026-07-08' })]);
    expect(r.get('x')?.planStart).toBe('2026-07-07');
    expect(r.get('x')?.planEnd).toBe('2026-07-08');
  });
});
