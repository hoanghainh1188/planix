import { describe, expect, it } from 'vitest';
import {
  checkMilestonesOnHolidays,
  checkPhaseSkew,
  checkThinAllocations,
  type AuditAssignment,
  type AuditTask,
} from './schedule-audit.js';
import { unsafeDateOnly } from './date-only.js';

const d = unsafeDateOnly;

/** Ngày làm việc giả lập: đếm ngày lịch, bỏ thứ bảy và chủ nhật. */
function workingDaysBetween(a: string, b: string): number {
  let n = 0;
  const cursor = new Date(`${a}T00:00:00Z`);
  const end = new Date(`${b}T00:00:00Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) n++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return n;
}

function task(over: Partial<AuditTask> = {}): AuditTask {
  return { uid: 'T-1', wbsCode: '1.1', kind: 'work', locationId: 'VN', ...over };
}

describe('J07 — chênh lệch pha A và pha B (§7.2, §8.2)', () => {
  function skew(phaseAEnd: string | null, phaseBEnd: string | null) {
    return checkPhaseSkew({
      phaseAEnd: phaseAEnd === null ? null : d(phaseAEnd),
      phaseBEnd: phaseBEnd === null ? null : d(phaseBEnd),
      projectStart: d('2026-01-05'),
      workingDaysBetween: (a, b) => workingDaysBetween(a, b),
    });
  }

  it('pha B dài hơn quá 20% thì báo, mức Major', () => {
    // 2026-01-05 là thứ hai. Pha A tới 16/01 = 10 ngày làm; pha B tới 30/01 = 20 ngày.
    const issues = skew('2026-01-16', '2026-01-30');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('J07');
    expect(issues[0]?.severity).toBe('Major');
  });

  it('thông điệp nói ra CON SỐ để mang đi đàm phán thêm người (§7.2)', () => {
    expect(skew('2026-01-16', '2026-01-30')[0]?.message).toMatch(/100%.*10 → 20 working days/);
  });

  it('đúng 20% thì chưa — "quá 20%" là vượt, không phải chạm', () => {
    // 10 ngày làm → 12 ngày làm là đúng 20%.
    expect(skew('2026-01-16', '2026-01-20')).toEqual([]);
  });

  it('pha B bằng pha A thì sạch — không thiếu người', () => {
    expect(skew('2026-01-16', '2026-01-16')).toEqual([]);
  });

  it('đo bằng NGÀY LÀM VIỆC: trượt qua cuối tuần không phải chi phí thiếu người', () => {
    // 16/01 là thứ sáu; 18/01 là chủ nhật. Cùng 10 ngày làm việc.
    expect(skew('2026-01-16', '2026-01-18')).toEqual([]);
  });

  it('chưa có lịch thì im lặng', () => {
    expect(skew(null, '2026-01-30')).toEqual([]);
    expect(skew('2026-01-16', null)).toEqual([]);
  });
});

describe('J08 — milestone rơi vào ngày nghỉ (§5.4, §8.2)', () => {
  const holidays = new Set(['2026-01-01', '2026-01-17', '2026-01-18']);
  const isWorking = (_loc: string | null, date: string): boolean => {
    if (holidays.has(date)) return false;
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  };
  const nextWorking = (loc: string | null, date: string) => {
    const cursor = new Date(`${date}T00:00:00Z`);
    for (let i = 0; i < 30; i++) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const iso = cursor.toISOString().slice(0, 10);
      if (isWorking(loc, iso)) return d(iso);
    }
    throw new Error('khong tim ra ngay lam viec');
  };

  function run(tasks: readonly AuditTask[], endDate: string) {
    return checkMilestonesOnHolidays({
      tasks,
      schedule: tasks.map((t) => ({ taskUid: t.uid, startDate: d(endDate), endDate: d(endDate) })),
      isWorkingAtLocation: (loc, date) => isWorking(loc, date),
      nextWorkingDayAtLocation: (loc, date) => nextWorking(loc, date),
    });
  }

  it('mốc rơi vào lễ thì báo, KÈM ngày làm việc gần nhất', () => {
    const issues = run([task({ kind: 'milestone', wbsCode: '2.0' })], '2026-01-01');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('J08');
    // §5.4 đòi "kèm ngày gần nhất" — thiếu nó thì PM lại phải đi tra lịch.
    expect(issues[0]?.message).toContain('Nearest is 2026-01-02');
  });

  it('mốc rơi vào cuối tuần cũng vậy', () => {
    expect(run([task({ kind: 'milestone' })], '2026-01-17')).toHaveLength(1);
  });

  it('mốc vào ngày làm việc thì sạch', () => {
    expect(run([task({ kind: 'milestone' })], '2026-01-06')).toEqual([]);
  });

  it('task thường rơi vào ngày nghỉ thì KHÔNG báo — rule nói về milestone', () => {
    expect(run([task({ kind: 'work' })], '2026-01-01')).toEqual([]);
  });

  it('mốc chưa xếp lịch thì im lặng', () => {
    const issues = checkMilestonesOnHolidays({
      tasks: [task({ kind: 'milestone' })],
      schedule: [],
      isWorkingAtLocation: (loc, date) => isWorking(loc, date),
      nextWorkingDayAtLocation: (loc, date) => nextWorking(loc, date),
    });
    expect(issues).toEqual([]);
  });
});

describe('N06 — task bị chia mỏng (§7.5, §8.3)', () => {
  function assignment(over: Partial<AuditAssignment> = {}): AuditAssignment {
    return {
      taskUid: 'T-1',
      resourceId: 'R-1',
      allocation: 0.25,
      fromDate: d('2026-01-05'),
      toDate: d('2026-01-30'),
      ...over,
    };
  }
  function run(a: AuditAssignment) {
    return checkThinAllocations({
      tasks: [task()],
      assignments: [a],
      workingDaysBetween: (x, y) => workingDaysBetween(x, y),
    });
  }

  it('dưới 0.5 và kéo dài trên 10 ngày làm thì báo', () => {
    const issues = run(assignment());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('N06');
    expect(issues[0]?.severity).toBe('Minor');
  });

  it('đúng 0.5 thì không — "dưới 0.5" là nhỏ hơn', () => {
    expect(run(assignment({ allocation: 0.5 }))).toEqual([]);
  });

  it('mỏng nhưng ngắn thì không — chia mỏng vài ngày là cách xếp lịch bình thường', () => {
    expect(run(assignment({ toDate: d('2026-01-09') }))).toEqual([]);
  });

  it('đúng 10 ngày làm thì chưa — "trên 10 ngày" là vượt', () => {
    // 05/01 (thứ hai) → 16/01 (thứ sáu) = đúng 10 ngày làm việc.
    expect(run(assignment({ toDate: d('2026-01-16') }))).toEqual([]);
  });

  it('đo bằng ngày LÀM VIỆC, không phải ngày lịch', () => {
    // 05/01 → 19/01 là 15 ngày lịch nhưng chỉ 11 ngày làm — vẫn vượt, nhưng sát ngưỡng.
    expect(run(assignment({ toDate: d('2026-01-19') }))).toHaveLength(1);
  });

  it('assignment của task không còn trong danh sách thì bỏ qua, không nổ', () => {
    const issues = checkThinAllocations({
      tasks: [],
      assignments: [assignment()],
      workingDaysBetween: (x, y) => workingDaysBetween(x, y),
    });
    expect(issues).toEqual([]);
  });
});
