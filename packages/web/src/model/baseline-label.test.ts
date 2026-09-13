import { describe, expect, it } from 'vitest';
import { suggestedBaselineLabel } from './baseline-label.js';

describe('suggestedBaselineLabel', () => {
  it('bản đầu tiên là Plan v1.0 — §7.13 gọi đó là mốc cam kết', () => {
    expect(suggestedBaselineLabel(0)).toBe('Plan v1.0');
  });

  it('đánh số tiếp theo số bản đã có', () => {
    expect(suggestedBaselineLabel(1)).toBe('Plan v1.1');
    expect(suggestedBaselineLabel(7)).toBe('Plan v1.7');
  });

  it('số vô nghĩa thì lùi về bản đầu, không sinh ra tên rác', () => {
    expect(suggestedBaselineLabel(-3)).toBe('Plan v1.0');
    expect(suggestedBaselineLabel(Number.NaN)).toBe('Plan v1.0');
  });
});
