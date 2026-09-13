import { describe, expect, it } from 'vitest';
import {
  compareByPriorityKey,
  compareByResourceKey,
  compareWbsCode,
  type PriorityCandidate,
  type ResourceCandidate,
} from './tie-break.js';
import { unsafeDateOnly as d } from './date-only.js';

function p(over: Partial<PriorityCandidate>): PriorityCandidate {
  return { uid: 'T-1', priority: 500, ls: d('2026-05-04'), totalFloat: 0, wbsCode: '1', ...over };
}

function r(over: Partial<ResourceCandidate>): ResourceCandidate {
  return {
    resourceId: 'R-1',
    expectedFinish: d('2026-05-04'),
    proficiency: 1,
    assignedMd: 0,
    ...over,
  };
}

describe('compareWbsCode — natural sort (§7.4 bậc 4)', () => {
  it('1.9 đứng trước 1.10 — so chuỗi thuần sẽ sai chỗ này', () => {
    expect(compareWbsCode('1.9', '1.10')).toBeLessThan(0);
    expect('1.9' < '1.10').toBe(false); // chung minh so chuoi thuan sai
  });

  it('sắp đúng cả cây', () => {
    const got = ['2.1', '1.10', '1.2', '1', '10', '1.1.1'].sort(compareWbsCode);
    expect(got).toEqual(['1', '1.1.1', '1.2', '1.10', '2.1', '10']);
  });

  it('mã ngắn hơn đứng trước mã dài cùng tiền tố', () => {
    expect(compareWbsCode('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('bằng nhau thì trả 0', () => {
    expect(compareWbsCode('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('PRIORITY_KEY — đúng thứ tự 5 bậc §7.4', () => {
  it('bậc 1: priority tăng dần, 1 là cao nhất', () => {
    expect(compareByPriorityKey(p({ priority: 1 }), p({ priority: 500 }))).toBeLessThan(0);
  });

  it('bậc 2: priority hoà thì ls sớm hơn thắng', () => {
    const a = p({ ls: d('2026-05-04') });
    const b = p({ ls: d('2026-05-06') });
    expect(compareByPriorityKey(a, b)).toBeLessThan(0);
  });

  it('bậc 3: ls hoà thì total_float nhỏ hơn thắng', () => {
    expect(compareByPriorityKey(p({ totalFloat: 0 }), p({ totalFloat: 3 }))).toBeLessThan(0);
  });

  it('bậc 4: float hoà thì wbs_code natural sort', () => {
    expect(compareByPriorityKey(p({ wbsCode: '1.9' }), p({ wbsCode: '1.10' }))).toBeLessThan(0);
  });

  it('bậc 5: wbs_code hoà thì uid — chốt chặn, không bao giờ hoà', () => {
    expect(compareByPriorityKey(p({ uid: 'T-0001' }), p({ uid: 'T-0002' }))).toBeLessThan(0);
    expect(compareByPriorityKey(p({ uid: 'T-1' }), p({ uid: 'T-1' }))).toBe(0);
  });

  it('bậc trên THẮNG bậc dưới: priority thấp thắng dù float lớn', () => {
    const urgent = p({ priority: 1, totalFloat: 99, uid: 'Z' });
    const slack = p({ priority: 500, totalFloat: 0, uid: 'A' });
    expect(compareByPriorityKey(urgent, slack)).toBeLessThan(0);
  });

  it('sắp một danh sách cho kết quả ổn định bất kể thứ tự vào', () => {
    const list = [
      p({ uid: 'C', priority: 500, wbsCode: '1.2' }),
      p({ uid: 'A', priority: 100, wbsCode: '1.10' }),
      p({ uid: 'B', priority: 500, wbsCode: '1.1' }),
    ];
    const forward = [...list].sort(compareByPriorityKey).map((x) => x.uid);
    const backward = [...list]
      .reverse()
      .sort(compareByPriorityKey)
      .map((x) => x.uid);
    expect(forward).toEqual(['A', 'B', 'C']);
    expect(backward).toEqual(forward);
  });
});

describe('RESOURCE_KEY — đúng thứ tự 4 bậc §7.4', () => {
  it('bậc 1: ngày kết thúc dự kiến sớm nhất', () => {
    const early = r({ expectedFinish: d('2026-05-04') });
    const late = r({ expectedFinish: d('2026-05-08') });
    expect(compareByResourceKey(early, late)).toBeLessThan(0);
  });

  it('bậc 2: cùng ngày xong thì proficiency NHỎ hơn thắng (1.0 chuẩn, 1.2 chậm hơn)', () => {
    expect(compareByResourceKey(r({ proficiency: 1 }), r({ proficiency: 1.2 }))).toBeLessThan(0);
  });

  it('bậc 3: proficiency hoà thì ai đang gánh ít MD hơn', () => {
    expect(compareByResourceKey(r({ assignedMd: 2 }), r({ assignedMd: 10 }))).toBeLessThan(0);
  });

  it('bậc 4: resource.id — chốt chặn', () => {
    expect(compareByResourceKey(r({ resourceId: 'R-01' }), r({ resourceId: 'R-02' }))).toBeLessThan(
      0,
    );
  });

  it('bậc trên thắng bậc dưới: xong sớm hơn thắng dù gánh nặng hơn', () => {
    const busy = r({ expectedFinish: d('2026-05-04'), assignedMd: 100, resourceId: 'R-99' });
    const idle = r({ expectedFinish: d('2026-05-05'), assignedMd: 0, resourceId: 'R-01' });
    expect(compareByResourceKey(busy, idle)).toBeLessThan(0);
  });

  it('sắp ổn định bất kể thứ tự vào', () => {
    const list = [
      r({ resourceId: 'R-3', expectedFinish: d('2026-05-06') }),
      r({ resourceId: 'R-1', expectedFinish: d('2026-05-04') }),
      r({ resourceId: 'R-2', expectedFinish: d('2026-05-04') }),
    ];
    const forward = [...list].sort(compareByResourceKey).map((x) => x.resourceId);
    expect(forward).toEqual(['R-1', 'R-2', 'R-3']);
    expect(
      [...list]
        .reverse()
        .sort(compareByResourceKey)
        .map((x) => x.resourceId),
    ).toEqual(forward);
  });
});
