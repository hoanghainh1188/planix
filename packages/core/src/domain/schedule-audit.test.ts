import { describe, expect, it } from 'vitest';
import {
  checkMilestonesOnHolidays,
  checkPhaseSkew,
  checkResourceUtilisation,
  checkThinAllocations,
  type AuditAssignment,
  type UtilisationAssignment,
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

describe('J06 — resource dùng dưới 30% (§8.2, PM chốt 2026-09-13)', () => {
  /** Lịch A giả lập: làm thứ hai–thứ sáu, trừ những ngày nghỉ riêng của từng người. */
  function makeCapacity(leave: Readonly<Record<string, readonly string[]>> = {}) {
    return (resourceId: string, date: string): number => {
      if ((leave[resourceId] ?? []).includes(date)) return 0;
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6 ? 0 : 1;
    };
  }

  function run(
    assignments: readonly UtilisationAssignment[],
    over: { resourceIds?: readonly string[]; leave?: Record<string, readonly string[]> } = {},
  ) {
    return checkResourceUtilisation({
      resourceIds: over.resourceIds ?? ['R-1'],
      assignments,
      windowStart: d('2026-01-05'),
      windowEnd: d('2026-01-30'),
      capacityOn: (r, date) => makeCapacity(over.leave ?? {})(r, date),
    });
  }

  /**
   * `effortMd` suy ra từ `allocation` × số ngày làm của bao ngoài.
   *
   * Tức là mô tả một task LẤP KÍN bao ngoài của nó — và đó chính là trường hợp duy nhất
   * mà cách tính cũ (`allocation` × mọi ngày) cho ra đúng kết quả. Mọi ca dưới đây đều
   * thuộc loại đó, nên chúng không đổi đáp án khi rule chuyển sang rải theo effort.
   *
   * Ca mà cách cũ tính SAI — bao ngoài rộng hơn phần việc — nằm ở test riêng cuối describe.
   */
  function busy(
    resourceId: string,
    allocation: number,
    from = '2026-01-05',
    to = '2026-01-30',
    leave: Readonly<Record<string, readonly string[]>> = {},
  ) {
    const capacity = makeCapacity(leave);
    let workingDays = 0;
    for (
      let cursor = new Date(`${from}T00:00:00Z`);
      cursor <= new Date(`${to}T00:00:00Z`);
      cursor = new Date(cursor.getTime() + 86400000)
    ) {
      workingDays += capacity(resourceId, cursor.toISOString().slice(0, 10));
    }
    return {
      taskUid: 'T-1',
      resourceId,
      allocation,
      fromDate: d(from),
      toDate: d(to),
      effortMd: allocation * workingDays,
    };
  }

  it('gần như không có việc thì báo, mức Major', () => {
    // Cửa sổ có 20 ngày làm; một assignment 1.0 trong 2 ngày = 10%.
    const issues = run([busy('R-1', 1, '2026-01-05', '2026-01-06')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('J06');
    expect(issues[0]?.severity).toBe('Major');
    expect(issues[0]?.message).toContain('10% utilised');
  });

  it('bận thì không báo', () => {
    expect(run([busy('R-1', 1)])).toEqual([]);
  });

  it('đúng 50% thì chưa — "dưới 50%" là nhỏ hơn', () => {
    // Cửa sổ có 20 ngày làm; 10 ngày làm ở mức 1.0 = đúng 50%.
    expect(run([busy('R-1', 1, '2026-01-05', '2026-01-16')])).toEqual([]);
  });

  /**
   * Đây là lý do rule này phải đo trên pool CHUNG. §7.12 cho hai dự án dùng chung người;
   * chỉ đếm assignment của dự án đang xét sẽ biến một người bận kín ở nơi khác thành
   * "rảnh 0%" — cảnh báo sai trên mọi dự án, ngay từ dự án thứ hai.
   */
  it('bận ở dự án KHÁC thì vẫn là bận — không báo', () => {
    const issues = run([
      busy('R-1', 0.1, '2026-01-05', '2026-01-06'), // chút việc ở dự án này
      busy('R-1', 1, '2026-01-05', '2026-01-30'), // kín ở dự án khác
    ]);
    expect(issues).toEqual([]);
  });

  it('chỉ báo cho người CÓ trong danh sách — không dội issue về cả pool', () => {
    const issues = run([busy('R-1', 1), busy('R-2', 0)], { resourceIds: ['R-1'] });
    expect(issues.map((i) => i.detail?.['resourceId'])).toEqual([]);

    const both = run([busy('R-1', 1)], { resourceIds: ['R-1', 'R-2'] });
    // R-2 không có assignment nào → 0% → bị báo, nhưng CHỈ khi nó nằm trong danh sách.
    expect(both.map((i) => i.detail?.['resourceId'])).toEqual(['R-2']);
  });

  /**
   * Ca mà cách tính CŨ trả lời sai — lý do rule này phải đổi.
   *
   * `assignment.from_date`/`to_date` là **bao ngoài**, không phải danh sách ngày làm. SGS
   * giữ chỗ trên một số ngày cụ thể bên trong rồi chỉ ghi hai đầu mút; DB không lưu danh
   * sách ngày. Một task 2 MD trải trên cả cửa sổ 20 ngày là chuyện bình thường — người đó
   * chỉ thật sự bận 2 ngày.
   *
   * Cách cũ nhân `allocation = 1` với cả 20 ngày ⇒ đọc ra **100%**, và im lặng. Cách đúng
   * rải 2 MD trên 20 ngày ⇒ **10%**, và báo J06 — đúng thứ §7.2 muốn nêu ra.
   *
   * Đo trên `data/dev.db`: lệch 6–32 điểm phần trăm; R-03 đọc 83% trong khi thật là 51%.
   */
  it('bao ngoài rộng hơn phần việc: phải đọc ra tỷ lệ THẬT, không phải 100%', () => {
    const thinlySpread = {
      taskUid: 'T-mong',
      resourceId: 'R-1',
      // `allocation` vẫn là 1 — đó chính là chỗ đánh lừa cách tính cũ.
      allocation: 1,
      fromDate: d('2026-01-05'),
      toDate: d('2026-01-30'),
      // …nhưng task chỉ có 2 MD việc.
      effortMd: 2,
    };

    const issues = run([thinlySpread]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('J06');
    expect(issues[0]?.message).toContain('10% utilised');
  });

  /**
   * Mẫu số là năng lực THẬT, không phải số ngày lịch. Người nghỉ phép gần hết cửa sổ mà
   * vẫn làm trọn những ngày còn lại thì không phải người rảnh.
   */
  it('nghỉ phép không biến người ta thành lười', () => {
    const leaveDays: string[] = [];
    for (const day of [12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30]) {
      leaveDays.push(`2026-01-${String(day).padStart(2, '0')}`);
    }
    const issues = run([busy('R-1', 1, '2026-01-05', '2026-01-09', { 'R-1': leaveDays })], {
      leave: { 'R-1': leaveDays },
    });
    // Chỉ còn 5 ngày làm trong cửa sổ, và cả 5 đều có việc → 100%.
    expect(issues).toEqual([]);
  });

  it('không có ngày làm nào trong cửa sổ thì im lặng, không chia cho 0', () => {
    const allDays: string[] = [];
    for (let day = 1; day <= 31; day++) allDays.push(`2026-01-${String(day).padStart(2, '0')}`);
    expect(run([], { leave: { 'R-1': allDays } })).toEqual([]);
  });

  it('cửa sổ rỗng (mốc chuẩn đã qua ngày kết thúc) thì im lặng', () => {
    const issues = checkResourceUtilisation({
      resourceIds: ['R-1'],
      assignments: [],
      windowStart: d('2026-02-01'),
      windowEnd: d('2026-01-01'),
      capacityOn: () => 1,
    });
    expect(issues).toEqual([]);
  });

  /**
   * Cả ba đều rảnh ⇒ gộp thành MỘT issue mức dự án, nên thứ tự nằm trong `detail`.
   *
   * N2 vẫn là thứ đang kiểm: danh sách phải sắp theo id, không theo thứ tự mảng vào.
   */
  it('thứ tự trong danh sách theo id, không theo thứ tự mảng vào (N2)', () => {
    const issues = run([], { resourceIds: ['R-9', 'R-1', 'R-5'] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail?.['resourceIds']).toEqual(['R-1', 'R-5', 'R-9']);
  });

  /**
   * Gộp CHỈ khi cả đội cùng dưới ngưỡng — PM chốt 2026-09-14.
   *
   * Một người rảnh giữa một đội bận là phát hiện về CHÍNH người đó, và nêu đích danh mới
   * dùng được. Cả đội cùng rảnh mới là phát hiện mức dự án.
   */
  it('chỉ MỘT người rảnh thì nêu đích danh, không gộp', () => {
    const issues = run([busy('R-1', 1), busy('R-2', 1), busy('R-3', 0.1)], {
      resourceIds: ['R-1', 'R-2', 'R-3'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail?.['resourceId']).toBe('R-3');
    expect(issues[0]?.message).toContain('Resource R-3');
  });

  it('cả đội cùng rảnh thì gộp, kèm khoảng cao–thấp', () => {
    const issues = run([busy('R-1', 0.1), busy('R-2', 0.2)], {
      resourceIds: ['R-1', 'R-2'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail?.['scope']).toBe('project');
    expect(issues[0]?.detail?.['resourceCount']).toBe(2);
    expect(issues[0]?.message).toContain('All 2 people');
  });

  /** Một người tất cả thì gộp vô nghĩa — vẫn nêu đích danh. */
  it('chỉ có một người trong dự án thì không gộp', () => {
    const issues = run([busy('R-1', 0.1)], { resourceIds: ['R-1'] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail?.['resourceId']).toBe('R-1');
  });
});
