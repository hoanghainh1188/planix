/**
 * §7 pha C bước C1 — đường găng sau khi san tài nguyên.
 *
 * Test viết TRƯỚC cài đặt (CLAUDE.md §2). Mỗi ca dựng tay một lịch nhỏ có đáp án tính
 * được bằng mắt, không dùng fixture lớn — cái cần khoá ở đây là ĐỊNH NGHĨA, không phải
 * quy mô.
 */

import { describe, expect, it } from 'vitest';
import type { DateOnly } from './date-only.js';
import {
  resourceCriticalPath,
  type RcAssignment,
  type RcScheduleRow,
} from './resource-critical.js';

const d = (s: string): DateOnly => s as DateOnly;

/**
 * Lịch giả: thứ Hai–Sáu, không lễ.
 *
 * Dùng lịch thật ở đây sẽ trộn hai thứ cần kiểm riêng — quy tắc ngày nghỉ đã có test
 * riêng trong `calendar.test.ts`.
 */
const engine = {
  capacityOn(_res: string, date: DateOnly): number {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return dow === 0 || dow === 6 ? 0 : 1;
  },
  addWorkingDays(_cal: string, from: DateOnly, days: number): DateOnly {
    let cursor = new Date(`${from}T00:00:00Z`);
    let left = days;
    if (left === 0) return from;
    const step = left > 0 ? 1 : -1;
    while (left !== 0) {
      cursor = new Date(cursor.getTime() + step * 86400000);
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) left -= step;
    }
    return cursor.toISOString().slice(0, 10) as DateOnly;
  },
};

interface Case {
  readonly schedule: Record<string, [string, string]>;
  readonly edges?: ReadonlyArray<{
    predUid: string;
    succUid: string;
    type: 'FS' | 'SS' | 'FF' | 'SF';
    lagDays: number;
  }>;
  readonly assignments?: readonly RcAssignment[];
}

function call(c: Case, overrideEngine?: typeof engine): ReturnType<typeof resourceCriticalPath> {
  const schedule = new Map<string, RcScheduleRow>(
    Object.entries(c.schedule).map(([uid, [s, e]]) => [uid, { startDate: d(s), endDate: d(e) }]),
  );
  return resourceCriticalPath({
    schedule,
    edges: c.edges ?? [],
    assignments: c.assignments ?? [],
    engine: overrideEngine ?? engine,
    calendarId: 'CAL',
  });
}

/** Tập găng nghĩa CHẶT. */
function run(c: Case, overrideEngine?: typeof engine): string[] {
  return [...call(c, overrideEngine).critical].sort();
}

/** Tập chỉ rời khỏi chuỗi vì lệch lịch. */
function near(c: Case, overrideEngine?: typeof engine): string[] {
  return [...call(c, overrideEngine).nearCritical].sort();
}

describe('resourceCriticalPath', () => {
  it('lịch rỗng thì không có gì găng', () => {
    expect(run({ schedule: {} })).toEqual([]);
  });

  it('một task đơn độc là task quyết định ngày kết thúc', () => {
    expect(run({ schedule: { A: ['2026-01-05', '2026-01-06'] } })).toEqual(['A']);
  });

  /** Chuỗi FS sát nhau: cả ba cùng quyết định ngày kết thúc. */
  it('lần ngược chuỗi FS không có khoảng hở', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          B: ['2026-01-07', '2026-01-08'],
          C: ['2026-01-09', '2026-01-09'],
        },
        edges: [
          { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
          { predUid: 'B', succUid: 'C', type: 'FS', lagDays: 0 },
        ],
      }),
    ).toEqual(['A', 'B', 'C']);
  });

  /**
   * B có thời gian dư trước C: dời B một ngày không đẩy C, nên B KHÔNG găng.
   *
   * Đây là ca phân biệt "đường găng" với "mọi task có ràng buộc".
   */
  it('task có khoảng hở thì không găng', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          B: ['2026-01-07', '2026-01-07'],
          C: ['2026-01-12', '2026-01-13'],
        },
        edges: [
          { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
          { predUid: 'B', succUid: 'C', type: 'FS', lagDays: 0 },
        ],
      }),
    ).toEqual(['C']);
  });

  it('lag được tính vào, không chỉ so ngày liền kề', () => {
    // A xong 06, lag 2 ngày làm việc → B sớm nhất là 09. B bắt đầu đúng 09 ⇒ ràng buộc.
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-06'], B: ['2026-01-09', '2026-01-09'] },
        edges: [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 2 }],
      }),
    ).toEqual(['A', 'B']);
  });

  it('SS lấy mốc ngày BẮT ĐẦU của predecessor', () => {
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-09'], B: ['2026-01-06', '2026-01-12'] },
        edges: [{ predUid: 'A', succUid: 'B', type: 'SS', lagDays: 1 }],
      }),
    ).toEqual(['A', 'B']);
  });

  /**
   * Cốt lõi của phương án (b) PM chốt: B chờ NGƯỜI chứ không chờ ràng buộc.
   *
   * Không có cạnh dependency nào giữa A và B. Chúng dùng chung R-1, A xong 06, B bắt
   * đầu 07. Bỏ qua liên kết do người thì B trông như task tự do và đường găng chỉ có
   * mình B — mất đúng thông tin §7.2 gọi là chi phí thiếu người.
   */
  it('coi liên kết do người là cạnh (phương án b)', () => {
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-06'], B: ['2026-01-07', '2026-01-08'] },
        assignments: [
          { taskUid: 'A', resourceId: 'R-1', fromDate: d('2026-01-05'), toDate: d('2026-01-06') },
          { taskUid: 'B', resourceId: 'R-1', fromDate: d('2026-01-07'), toDate: d('2026-01-08') },
        ],
      }),
    ).toEqual(['A', 'B']);
  });

  it('người khác nhau thì không sinh cạnh', () => {
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-06'], B: ['2026-01-07', '2026-01-08'] },
        assignments: [
          { taskUid: 'A', resourceId: 'R-1', fromDate: d('2026-01-05'), toDate: d('2026-01-06') },
          { taskUid: 'B', resourceId: 'R-2', fromDate: d('2026-01-07'), toDate: d('2026-01-08') },
        ],
      }),
    ).toEqual(['B']);
  });

  it('cùng người nhưng có khoảng hở thì không găng', () => {
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-06'], B: ['2026-01-12', '2026-01-13'] },
        assignments: [
          { taskUid: 'A', resourceId: 'R-1', fromDate: d('2026-01-05'), toDate: d('2026-01-06') },
          { taskUid: 'B', resourceId: 'R-1', fromDate: d('2026-01-12'), toDate: d('2026-01-13') },
        ],
      }),
    ).toEqual(['B']);
  });

  /** Cạnh do người nối được hai nhánh vốn KHÔNG có quan hệ dependency nào. */
  it('chuỗi trộn dependency và người', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          B: ['2026-01-07', '2026-01-08'],
          C: ['2026-01-09', '2026-01-09'],
        },
        edges: [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
        assignments: [
          { taskUid: 'B', resourceId: 'R-1', fromDate: d('2026-01-07'), toDate: d('2026-01-08') },
          { taskUid: 'C', resourceId: 'R-1', fromDate: d('2026-01-09'), toDate: d('2026-01-09') },
        ],
      }),
    ).toEqual(['A', 'B', 'C']);
  });

  it('hai nhánh cùng kết thúc ngày cuối thì cả hai đều găng', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-08'],
          B: ['2026-01-05', '2026-01-08'],
        },
      }),
    ).toEqual(['A', 'B']);
  });

  it('hai predecessor cùng ràng buộc thì cả hai đều găng', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          B: ['2026-01-05', '2026-01-06'],
          C: ['2026-01-07', '2026-01-08'],
        },
        edges: [
          { predUid: 'A', succUid: 'C', type: 'FS', lagDays: 0 },
          { predUid: 'B', succUid: 'C', type: 'FS', lagDays: 0 },
        ],
      }),
    ).toEqual(['A', 'B', 'C']);
  });

  /** Mốc duration 0 vẫn là một mắt trong chuỗi, không bị bỏ qua. */
  it('milestone nằm trong chuỗi', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          M: ['2026-01-07', '2026-01-07'],
          B: ['2026-01-08', '2026-01-08'],
        },
        edges: [
          { predUid: 'A', succUid: 'M', type: 'FS', lagDays: 0 },
          { predUid: 'M', succUid: 'B', type: 'FS', lagDays: 0 },
        ],
      }),
    ).toEqual(['A', 'B', 'M']);
  });

  /**
   * Task bắt đầu MUỘN hơn mọi mốc ép ⇒ nó có dư thời gian, và chuỗi dừng ở đây.
   *
   * Không phải ca giả định. Đo trên `data/dev.db`: dự án GEO chạy lịch VN
   * (`default_location = 'VN'`) nhưng người làm ở JP. Mốc ép từ predecessor rơi vào
   * 2026-07-20 — ngày làm việc bình thường ở VN, nhưng là 海の日 ở Nhật. Người đó vào
   * việc 07-21.
   *
   * Dời predecessor thêm một ngày làm việc VN thì mốc thành 07-21, và task VẪN bắt đầu
   * 07-21. Nghĩa là predecessor có đúng một ngày dư — nó KHÔNG găng. Chuỗi GEO ngắn là
   * câu trả lời ĐÚNG, không phải lỗi.
   *
   * Test này khoá lại điều đó. Ai thấy chuỗi ngắn rồi nới `===` thành `<=` để nó dài ra
   * sẽ làm đỏ chỗ này — và đó chính là mục đích (CLAUDE.md §8: không nới rule vì kết quả
   * trông không như mong đợi).
   */
  it('lệch lịch tạo ra dư thời gian thật, chuỗi dừng đúng chỗ', () => {
    expect(
      run({
        schedule: {
          A: ['2026-01-05', '2026-01-06'],
          // A xong 06 ⇒ mốc ép là 07. B bắt đầu 08, muộn hơn một ngày.
          B: ['2026-01-08', '2026-01-09'],
        },
        edges: [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
      }),
    ).toEqual(['B']);
  });

  /**
   * Chu trình không được phép tồn tại (`C05` chặn ở validate), nhưng lịch là dữ liệu đã
   * lưu và có thể cũ hơn cấu trúc. Một vòng ở đây phải dừng, không treo tiến trình.
   */
  it('không treo khi dữ liệu có vòng', () => {
    expect(
      run({
        schedule: { A: ['2026-01-05', '2026-01-06'], B: ['2026-01-07', '2026-01-08'] },
        edges: [
          { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
          { predUid: 'B', succUid: 'A', type: 'FS', lagDays: 0 },
        ],
      }).length,
    ).toBeGreaterThan(0);
  });

  /** N2: cùng input phải ra cùng kết quả, không phụ thuộc thứ tự mảng vào. */
  it('tất định — đảo thứ tự đầu vào không đổi kết quả', () => {
    const schedule = {
      A: ['2026-01-05', '2026-01-06'] as [string, string],
      B: ['2026-01-07', '2026-01-08'] as [string, string],
      C: ['2026-01-09', '2026-01-09'] as [string, string],
    };
    const edges = [
      { predUid: 'A' as const, succUid: 'B' as const, type: 'FS' as const, lagDays: 0 },
      { predUid: 'B' as const, succUid: 'C' as const, type: 'FS' as const, lagDays: 0 },
    ];
    expect(run({ schedule, edges })).toEqual(run({ schedule, edges: [...edges].reverse() }));
  });
});

/**
 * Phương án (iii) PM chốt 2026-09-14: giữ nghĩa chặt, thêm nhãn cho phần chuỗi bị cắt vì
 * LỆCH LỊCH.
 *
 * Phân biệt then chốt — và là lý do rule này không dùng ngưỡng bằng số ngày:
 *
 *   - Người đó CÓ thể làm trong khoảng hở ⇒ có chỗ trống thật ⇒ không gắn nhãn.
 *   - Người đó KHÔNG làm được ngày nào trong khoảng ⇒ task đã bắt đầu sớm nhất có thể
 *     ⇒ "dư" chỉ là lệch lịch ⇒ gắn nhãn.
 *
 * Ngưỡng cứng kiểu "3 ngày" sẽ vừa bắt hụt Golden Week vừa bắt nhầm chỗ trống thật đúng
 * 3 ngày. Đo bằng lịch A của đúng người đó thì không cần con số nào.
 */
describe('near-critical (phương án iii)', () => {
  /** Lịch có R-JP nghỉ 2026-01-06 và 2026-01-07; R-VN làm bình thường. */
  const twoCalendars = {
    ...engine,
    capacityOn(resourceId: string, date: DateOnly): number {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) return 0;
      if (resourceId === 'R-JP' && (date === '2026-01-06' || date === '2026-01-07')) return 0;
      return 1;
    },
  };

  /** A xong 05 ⇒ mốc ép 06. B chờ tới 08 vì người của nó nghỉ 06 và 07. */
  const holidayCase: Case = {
    schedule: { A: ['2026-01-05', '2026-01-05'], B: ['2026-01-08', '2026-01-09'] },
    edges: [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
    assignments: [
      { taskUid: 'B', resourceId: 'R-JP', fromDate: d('2026-01-08'), toDate: d('2026-01-09') },
    ],
  };

  it('nghỉ lễ làm đứt chuỗi chặt, nhưng predecessor được gắn nhãn gần găng', () => {
    expect(run(holidayCase, twoCalendars)).toEqual(['B']);
    expect(near(holidayCase, twoCalendars)).toEqual(['A']);
  });

  /**
   * Cùng ngày tháng y hệt, chỉ đổi người sang R-VN — người này làm được 06 và 07.
   *
   * Đây là ca phân định: nếu rule chỉ đếm số ngày hở thì hai ca này giống hệt nhau và
   * cả hai cùng được gắn nhãn. Chúng KHÔNG giống nhau — ở đây B thật sự có hai ngày để
   * thở, nên A không được gắn gì cả.
   */
  it('cùng khoảng hở nhưng người ĐI LÀM ⇒ là chỗ trống thật, không gắn nhãn', () => {
    const realSlack: Case = {
      ...holidayCase,
      assignments: [
        { taskUid: 'B', resourceId: 'R-VN', fromDate: d('2026-01-08'), toDate: d('2026-01-09') },
      ],
    };
    expect(run(realSlack, twoCalendars)).toEqual(['B']);
    expect(near(realSlack, twoCalendars)).toEqual([]);
  });

  it('hai tập rời nhau — task đã găng chặt thì không mang nhãn lỏng', () => {
    const r = call(holidayCase, twoCalendars);
    for (const uid of r.critical) expect(r.nearCritical.has(uid)).toBe(false);
  });

  it('chuỗi liền mạch thì không có gì gần găng', () => {
    const c: Case = {
      schedule: {
        A: ['2026-01-05', '2026-01-06'],
        B: ['2026-01-07', '2026-01-08'],
      },
      edges: [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
    };
    expect(run(c)).toEqual(['A', 'B']);
    expect(near(c)).toEqual([]);
  });

  /** Không ai được gán (mốc thuần §7.10) thì không có lịch A để hỏi — không kết luận. */
  it('task không có người thì không gắn nhãn', () => {
    const c: Case = {
      schedule: { A: ['2026-01-05', '2026-01-05'], M: ['2026-01-08', '2026-01-08'] },
      edges: [{ predUid: 'A', succUid: 'M', type: 'FS', lagDays: 0 }],
    };
    expect(near(c, twoCalendars)).toEqual([]);
  });
});
