import { describe, expect, it } from 'vitest';
import { compareDateOnly, isDateOnly, toDateOnly, unsafeDateOnly } from './date-only.js';

describe('isDateOnly', () => {
  it('chấp nhận ngày hợp lệ', () => {
    expect(isDateOnly('2026-09-12')).toBe(true);
    expect(isDateOnly('2026-01-01')).toBe(true);
    expect(isDateOnly('2026-12-31')).toBe(true);
  });

  it('từ chối sai định dạng', () => {
    expect(isDateOnly('2026-9-12')).toBe(false);
    expect(isDateOnly('2026/09/12')).toBe(false);
    expect(isDateOnly('12-09-2026')).toBe(false);
    expect(isDateOnly('2026-09-12T00:00:00Z')).toBe(false);
    expect(isDateOnly('')).toBe(false);
  });

  it('từ chối ngày không tồn tại — chỗ Date.parse tự sửa thành ngày khác', () => {
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-00-10')).toBe(false);
    expect(isDateOnly('2026-04-31')).toBe(false);
  });

  it('xử lý năm nhuận theo đúng luật 4/100/400', () => {
    expect(isDateOnly('2024-02-29')).toBe(true); // chia hết 4
    expect(isDateOnly('2026-02-29')).toBe(false); // không chia hết 4
    expect(isDateOnly('1900-02-29')).toBe(false); // chia hết 100, không chia hết 400
    expect(isDateOnly('2000-02-29')).toBe(true); // chia hết 400
  });
});

describe('toDateOnly', () => {
  it('trả lại chính chuỗi đó khi hợp lệ', () => {
    expect(toDateOnly('2026-09-12')).toBe('2026-09-12');
  });

  it('ném RangeError khi không hợp lệ', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow(RangeError);
  });
});

describe('compareDateOnly', () => {
  it('sắp đúng thứ tự thời gian', () => {
    expect(compareDateOnly(unsafeDateOnly('2026-01-01'), unsafeDateOnly('2026-01-02'))).toBe(-1);
    expect(compareDateOnly(unsafeDateOnly('2026-01-02'), unsafeDateOnly('2026-01-01'))).toBe(1);
    expect(compareDateOnly(unsafeDateOnly('2026-01-01'), unsafeDateOnly('2026-01-01'))).toBe(0);
  });

  it('so sánh đúng khi vượt mốc tháng và năm', () => {
    expect(compareDateOnly(unsafeDateOnly('2026-01-31'), unsafeDateOnly('2026-02-01'))).toBe(-1);
    expect(compareDateOnly(unsafeDateOnly('2026-12-31'), unsafeDateOnly('2027-01-01'))).toBe(-1);
  });

  it('dùng được làm tie-break ổn định cho sort', () => {
    const input = ['2026-03-01', '2026-01-15', '2026-01-02', '2026-12-31'].map(unsafeDateOnly);
    const sorted = [...input].sort(compareDateOnly);
    expect(sorted).toEqual(['2026-01-02', '2026-01-15', '2026-03-01', '2026-12-31']);
  });
});
