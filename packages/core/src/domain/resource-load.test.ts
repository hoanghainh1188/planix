/**
 * Ma trận người × kỳ — §12.1 `wbs_get_resource_load`.
 *
 * Mỗi ca dựng tay một lịch nhỏ có đáp án tính được bằng đầu. Thứ cần khoá là QUY ƯỚC
 * (đơn vị MD, mẫu số là năng lực thật, người rảnh vẫn hiện), không phải quy mô.
 */

import { describe, expect, it } from 'vitest';
import { unsafeDateOnly as d } from './date-only.js';
import {
  bucketOf,
  LoadWindowTooWideError,
  poolLoad,
  resourceLoad,
  type LoadSpan,
  type PoolSpan,
} from './resource-load.js';

/** T2–T6 làm cả ngày, cuối tuần nghỉ. `R-HALF` chỉ làm nửa ngày. */
const capacityOn = (resourceId: string, date: string): number => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return 0;
  return resourceId === 'R-HALF' ? 0.5 : 1;
};

/**
 * `effortMd` mới là thứ quyết định tải, KHÔNG phải `allocation`.
 *
 * `assignment.from_date`/`to_date` là bao ngoài; SGS chỉ giữ chỗ trên một số ngày bên
 * trong đó và bảng không lưu danh sách ngày. Nhân `allocation` với mọi ngày trong khoảng
 * là đếm cả ngày người đó không làm — đo trên `data/dev.db` thì cách cũ cho 1047,5 MD
 * trong khi effort thật là 837,0 MD.
 *
 * Mặc định ở đây: 5 ngày làm, 5 MD — tức đúng một tuần kín.
 */
function span(over: Partial<LoadSpan> = {}): LoadSpan {
  return {
    resourceId: 'R-1',
    resourceName: 'An',
    fromDate: d('2026-01-05'),
    toDate: d('2026-01-09'),
    allocation: 1,
    effortMd: 5,
    projectId: 'P',
    ...over,
  };
}

function run(over: Partial<Parameters<typeof resourceLoad>[0]> = {}) {
  return resourceLoad({
    spans: [],
    from: d('2026-01-05'),
    to: d('2026-01-09'),
    bucket: 'week',
    capacityOn: (r, date) => capacityOn(r, date),
    projectId: 'P',
    resourceIds: ['R-1'],
    nameOf: (id) => (id === 'R-1' ? 'An' : id),
    ...over,
  });
}

describe('bucketOf', () => {
  it('ngày giữ nguyên', () => {
    expect(bucketOf(d('2026-01-07'), 'day')).toBe('2026-01-07');
  });
  it('tháng cắt còn YYYY-MM', () => {
    expect(bucketOf(d('2026-01-07'), 'month')).toBe('2026-01');
  });
  it('tuần lùi về thứ Hai', () => {
    // 2026-01-07 là thứ Tư; thứ Hai cùng tuần là 2026-01-05.
    expect(bucketOf(d('2026-01-07'), 'week')).toBe('W2026-01-05');
    expect(bucketOf(d('2026-01-05'), 'week')).toBe('W2026-01-05');
    expect(bucketOf(d('2026-01-11'), 'week')).toBe('W2026-01-05'); // Chủ nhật vẫn tuần đó
    expect(bucketOf(d('2026-01-12'), 'week')).toBe('W2026-01-12'); // thứ Hai kế
  });
  /** Nhãn tuần phải sắp đúng bằng so chuỗi — đó là lý do dùng ngày thứ Hai, không dùng số tuần ISO. */
  it('nhãn tuần sắp đúng bằng so chuỗi qua giao thừa', () => {
    const labels = ['2026-12-28', '2027-01-04'].map((x) => bucketOf(d(x), 'week'));
    expect([...labels].sort()).toEqual(labels);
  });
});

describe('resourceLoad', () => {
  it('người RẢNH vẫn hiện, với capacity đầy đủ', () => {
    // Không có span nào. Đây là ca hay bị bỏ sót nhất, mà "ai đang rảnh" lại chính là
    // câu hỏi hay được hỏi nhất.
    const out = run();
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.totalAllocatedMd).toBe(0);
    expect(out.rows[0]?.totalCapacityMd).toBe(5);
    expect(out.rows[0]?.cells[0]?.utilisation).toBe(0);
  });

  it('một tuần kín là 5 MD trên 5 MD', () => {
    const out = run({ spans: [span()] });
    expect(out.rows[0]?.cells[0]).toMatchObject({
      allocatedMd: 5,
      capacityMd: 5,
      utilisation: 1,
      otherProjectMd: 0,
    });
  });

  it('cuối tuần không tính vào cả tử lẫn mẫu', () => {
    // Span kéo tới Chủ nhật, nhưng T7/CN không phải ngày làm.
    const out = run({ to: d('2026-01-11'), spans: [span({ toDate: d('2026-01-11') })] });
    expect(out.rows[0]?.totalCapacityMd).toBe(5);
    expect(out.rows[0]?.totalAllocatedMd).toBe(5);
  });

  /**
   * Bất biến quan trọng nhất của cách tính mới: tổng tải rải ra ĐÚNG BẰNG effort.
   *
   * Đây là thứ cách cũ vi phạm. Một task 3 MD trải trên 21 ngày làm với `allocation = 1`
   * bị đếm thành 21 MD — phóng đại 7 lần.
   */
  it('tổng tải bằng đúng effort, dù bao ngoài rộng tới đâu', () => {
    const out = run({
      from: d('2026-01-05'),
      to: d('2026-02-27'),
      bucket: 'month',
      // 3 MD trải trên một bao ngoài dài gần hai tháng.
      spans: [span({ toDate: d('2026-02-27'), effortMd: 3 })],
    });
    expect(out.rows[0]?.totalAllocatedMd).toBeCloseTo(3, 6);
  });

  /**
   * Quy ước đơn vị: `allocation × capacity`, không phải `allocation`.
   *
   * Người làm nửa ngày ở mức 0.5 allocation là 0.25 MD/ngày. Lệch quy ước này giữa đây
   * và `checkResourceUtilisation` (§8.2 `J06`) sẽ cho hai con số khác nhau cho cùng một
   * câu hỏi — và không ai biết con nào đúng.
   */
  it('người làm nửa ngày có mẫu số một nửa', () => {
    const out = run({
      resourceIds: ['R-HALF'],
      nameOf: () => 'Nửa buổi',
      spans: [span({ resourceId: 'R-HALF', effortMd: 1.25 })],
    });
    // Năng lực 0,5/ngày × 5 ngày = 2,5 MD.
    expect(out.rows[0]?.totalCapacityMd).toBe(2.5);
    expect(out.rows[0]?.totalAllocatedMd).toBe(1.25);
    expect(out.rows[0]?.cells[0]?.utilisation).toBe(0.5);
  });

  /**
   * Nghỉ lễ làm MẪU SỐ nhỏ đi, không làm người đó thành "rảnh".
   *
   * Lấy số ngày lịch làm mẫu số sẽ biến tuần có lễ thành tuần nhàn rỗi — đúng thứ khiến
   * con số này vô dụng với đội làm lịch Nhật.
   */
  it('ngày nghỉ trừ khỏi mẫu số', () => {
    const out = run({
      capacityOn: (r, date) => (date === '2026-01-07' ? 0 : capacityOn(r, date)),
      spans: [span({ effortMd: 4 })],
    });
    expect(out.rows[0]?.totalCapacityMd).toBe(4);
    expect(out.rows[0]?.totalAllocatedMd).toBe(4);
    expect(out.rows[0]?.cells[0]?.utilisation).toBe(1);
  });

  it('tách phần của dự án khác nhưng VẪN tính vào tỷ lệ', () => {
    const out = run({
      spans: [span({ effortMd: 2.5 }), span({ effortMd: 2.5, projectId: 'P-KHAC' })],
    });
    const cell = out.rows[0]?.cells[0];
    // Nhìn từ dự án này chỉ thấy 2,5 MD, nhưng người đó bận kín.
    expect(cell?.allocatedMd).toBe(2.5);
    expect(cell?.otherProjectMd).toBe(2.5);
    expect(cell?.utilisation).toBe(1);
  });

  it('chia đúng kỳ khi hỏi theo ngày', () => {
    const out = run({ bucket: 'day', spans: [span({ toDate: d('2026-01-06'), effortMd: 2 })] });
    expect(out.buckets).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
    ]);
    expect(out.rows[0]?.cells.map((c) => c.allocatedMd)).toEqual([1, 1, 0, 0, 0]);
  });

  it('gộp đúng khi hỏi theo tháng', () => {
    const out = run({
      bucket: 'month',
      from: d('2026-01-05'),
      to: d('2026-02-06'),
      spans: [span()],
    });
    expect(out.buckets).toEqual(['2026-01', '2026-02']);
    expect(out.rows[0]?.cells[0]?.allocatedMd).toBe(5);
    expect(out.rows[0]?.cells[1]?.allocatedMd).toBe(0);
  });

  it('không có ngày làm nào thì utilisation là null, không phải 0', () => {
    // Cuối tuần thuần tuý. 0 nghĩa là "đo được và bằng không"; null nghĩa là "không có
    // mẫu số để đo". AI phản ứng với hai cái đó khác nhau.
    const out = run({ from: d('2026-01-10'), to: d('2026-01-11') });
    expect(out.rows[0]?.cells[0]?.utilisation).toBeNull();
    expect(out.rows[0]?.cells[0]?.capacityMd).toBe(0);
  });

  it('khoảng đảo ngược trả rỗng, không ném', () => {
    expect(run({ from: d('2026-02-01'), to: d('2026-01-01') }).rows).toEqual([]);
  });

  it('khoảng quá rộng thì ném, không quét vô hạn', () => {
    expect(() => run({ from: d('2020-01-01'), to: d('2030-01-01') })).toThrow(
      LoadWindowTooWideError,
    );
  });

  it('tất định — đảo thứ tự đầu vào không đổi kết quả', () => {
    const spans = [span({ effortMd: 1.25 }), span({ resourceId: 'R-2', effortMd: 2.5 })];
    const opts = { resourceIds: ['R-2', 'R-1'], nameOf: (id: string) => id };
    const a = run({ ...opts, spans });
    const b = run({ ...opts, spans: [...spans].reverse() });
    expect(b).toEqual(a);
    expect(a.rows.map((r) => r.resourceId)).toEqual(['R-1', 'R-2']);
  });
});

/**
 * S9 — pool xuyên dự án (§10.3, §7.12).
 *
 * Khác `resourceLoad` ở chỗ không chia "của tôi / của người khác": màn này đứng ngoài mọi
 * dự án, nên câu hỏi là "ai đang giữ người này, và có ai bị đặt quá tay không".
 */
describe('poolLoad', () => {
  const people = [
    { id: 'R-1', name: 'An' },
    { id: 'R-2', name: 'Bình' },
  ];

  function pool(spans: readonly PoolSpan[], over: Record<string, unknown> = {}) {
    return poolLoad({
      spans,
      from: d('2026-01-05'),
      to: d('2026-01-09'),
      bucket: 'week',
      capacityOn: (r, date) => capacityOn(r, date),
      resources: people,
      ...over,
    });
  }

  function pspan(over: Partial<PoolSpan> = {}): PoolSpan {
    return {
      resourceId: 'R-1',
      resourceName: 'An',
      fromDate: d('2026-01-05'),
      toDate: d('2026-01-09'),
      allocation: 1,
      effortMd: 5,
      projectId: 'P-A',
      projectCode: 'AAA',
      ...over,
    };
  }

  it('liệt kê cả người chưa được xếp việc nào', () => {
    const out = pool([]);
    expect(out.rows.map((r) => r.resourceId)).toEqual(['R-1', 'R-2']);
    expect(out.rows[1]?.totalAllocatedMd).toBe(0);
    expect(out.rows[1]?.byProject).toEqual([]);
  });

  /**
   * Ca trung tâm của màn này: một người bị HAI dự án đặt chồng lên nhau.
   *
   * §7.12 sinh ra để tránh đúng chuyện này, và `J14` nói được dự án nào chiếm chỗ — nhưng
   * không nói được hình dạng: ai căng, căng vào tuần nào. Đó là thứ S9 phải hiện.
   */
  it('phát hiện đặt quá tay, và nói rõ dự án nào đang tranh', () => {
    const out = pool([
      pspan({ effortMd: 5, projectId: 'P-A', projectCode: 'AAA' }),
      pspan({ effortMd: 2.5, projectId: 'P-B', projectCode: 'BBB' }),
    ]);
    const an = out.rows[0];

    expect(an?.overbooked).toBe(true);
    expect(an?.cells[0]?.utilisation).toBe(1.5);
    // Nhiều MD nhất lên trước.
    expect(an?.byProject.map((p) => p.projectCode)).toEqual(['AAA', 'BBB']);
    expect(an?.byProject[0]?.md).toBe(5);
    expect(an?.byProject[1]?.md).toBe(2.5);
  });

  it('đặt vừa đủ thì KHÔNG coi là quá tay', () => {
    const out = pool([pspan({ effortMd: 5 })]);
    expect(out.rows[0]?.overbooked).toBe(false);
    expect(out.rows[0]?.cells[0]?.utilisation).toBe(1);
  });

  /** Ngày nghỉ trừ khỏi mẫu số, nên cùng khối lượng trên tuần ngắn là căng hơn. */
  it('tuần có lễ làm tỷ lệ cao lên', () => {
    const out = pool([pspan({ effortMd: 4, toDate: d('2026-01-08') })], {
      capacityOn: (r: string, date: string) => (date === '2026-01-09' ? 0 : capacityOn(r, date)),
    });
    // 4 ngày làm trên 4 ngày năng lực.
    expect(out.rows[0]?.totalCapacityMd).toBe(4);
    expect(out.rows[0]?.cells[0]?.utilisation).toBe(1);
  });

  it('tất định — đảo thứ tự đầu vào không đổi kết quả', () => {
    const spans = [
      pspan({ projectId: 'P-B', projectCode: 'BBB', effortMd: 2.5 }),
      pspan({ projectId: 'P-A', projectCode: 'AAA', effortMd: 2.5 }),
    ];
    expect(pool([...spans].reverse())).toEqual(pool(spans));
  });

  it('khoảng quá rộng thì ném, không quét vô hạn', () => {
    expect(() => pool([], { from: d('2020-01-01'), to: d('2030-01-01') })).toThrow(
      LoadWindowTooWideError,
    );
  });
});
