import { describe, expect, it } from 'vitest';
import { coveredYears, parseHolidayCsv } from './holiday-csv.js';

/** Trích thật từ syukujitsu.csv của 内閣府, gồm cả 振替休日 và 国民の休日. */
const SAMPLE = [
  '国民の祝日・休日月日,国民の祝日・休日名称',
  '2026/1/1,元日',
  '2026/1/12,成人の日',
  '2026/5/3,憲法記念日',
  '2026/5/6,休日',
  '2026/9/21,敬老の日',
  '2026/9/22,休日',
  '2026/9/23,秋分の日',
  '2027/3/21,春分の日',
  '2027/3/22,休日',
].join('\n');

describe('parseHolidayCsv', () => {
  it('bỏ header, đọc đúng ngày dạng YYYY/M/D', () => {
    const got = parseHolidayCsv(SAMPLE);
    expect(got[0]).toEqual({ date: '2026-01-01', name: '元日' });
    expect(got.map((e) => e.date)).toContain('2026-05-06');
  });

  it('giữ nguyên 振替休日 và 国民の休日, KHÔNG tự tính lại (§5.4)', () => {
    const got = parseHolidayCsv(SAMPLE, { years: [2026] });
    // 2026-05-06 la ngay bu vi 05-03 roi vao Chu nhat; 09-22 la 国民の休日 ke giua.
    expect(got.map((e) => e.date)).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-05-03',
      '2026-05-06',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);
  });

  it('lọc theo năm', () => {
    expect(coveredYears(parseHolidayCsv(SAMPLE, { years: [2027] }))).toEqual([2027]);
  });

  it('kết quả sắp theo ngày dù file xáo trộn', () => {
    const shuffled = ['2026/5/3,x', '2026/1/1,y', '2026/1/12,z'].join('\n');
    expect(parseHolidayCsv(shuffled).map((e) => e.date)).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-05-03',
    ]);
  });

  it('dòng rác và dòng trống bị bỏ qua, không làm hỏng cả file', () => {
    const messy = ['rác', '', '2026/1/1,元日', 'không phải ngày,gì đó'].join('\n');
    expect(parseHolidayCsv(messy)).toEqual([{ date: '2026-01-01', name: '元日' }]);
  });

  it('ngày trùng thì giữ lần đầu', () => {
    const dup = ['2026/1/1,元日', '2026/1/1,trùng'].join('\n');
    expect(parseHolidayCsv(dup)).toEqual([{ date: '2026-01-01', name: '元日' }]);
  });

  it('coveredYears cho biết nguồn phủ tới đâu', () => {
    expect(coveredYears(parseHolidayCsv(SAMPLE))).toEqual([2026, 2027]);
  });
});
