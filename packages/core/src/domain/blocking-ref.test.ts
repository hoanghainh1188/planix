import { describe, expect, it } from 'vitest';
import { resolveBlockingRefs, type RefEdge } from './blocking-ref.js';
import type { SgsScheduleRow } from './sgs.js';
import { unsafeDateOnly as d } from './date-only.js';

function row(
  start: string,
  end: string,
  reason: SgsScheduleRow['delayReason'] = null,
  ref: string | null = null,
): SgsScheduleRow {
  return {
    startDate: d(start),
    endDate: d(end),
    durationDays: 1,
    delayReason: reason,
    blockingRef: ref,
  };
}

/** A1, A2 → ~join-00001 → B1 : ràng buộc summary A → summary B đã mở ra. */
const JOIN = '~join-00001';
const edges: RefEdge[] = [
  { predUid: 'A1', succUid: JOIN, type: 'FS' },
  { predUid: 'A2', succUid: JOIN, type: 'FS' },
  { predUid: JOIN, succUid: 'B1', type: 'FS' },
];
const joins = new Set([JOIN]);

describe('resolveBlockingRefs — §7.6 ref phải là task thật', () => {
  it('ref vào nút gộp → lá mà nút gộp tự ghi là đã đẩy nó', () => {
    const full = new Map([
      ['A1', row('2026-01-05', '2026-01-06')],
      ['A2', row('2026-01-05', '2026-01-09')],
      [JOIN, row('2026-01-12', '2026-01-12', 'dependency', 'A2')],
      ['B1', row('2026-01-13', '2026-01-13', 'dependency', JOIN)],
    ]);
    const rows = new Map([...full].filter(([uid]) => uid !== JOIN));

    const out = resolveBlockingRefs(rows, full, edges, joins);
    expect(out.get('B1')?.blockingRef).toBe('A2');
    expect(out.get('B1')?.delayReason).toBe('dependency');
  });

  it('nút gộp không ghi ai đẩy → lá xong muộn nhất', () => {
    const full = new Map([
      ['A1', row('2026-01-05', '2026-01-08')],
      ['A2', row('2026-01-05', '2026-01-06')],
      [JOIN, row('2026-01-05', '2026-01-05')],
      ['B1', row('2026-01-09', '2026-01-09', 'dependency', JOIN)],
    ]);
    const out = resolveBlockingRefs(new Map([['B1', full.get('B1')!]]), full, edges, joins);
    expect(out.get('B1')?.blockingRef).toBe('A1');
  });

  it('hai lá xong cùng ngày → uid nhỏ hơn, mọi lần chạy như nhau (N2)', () => {
    const full = new Map([
      ['A2', row('2026-01-05', '2026-01-08')],
      ['A1', row('2026-01-05', '2026-01-08')],
      [JOIN, row('2026-01-05', '2026-01-05')],
      ['B1', row('2026-01-09', '2026-01-09', 'dependency', JOIN)],
    ]);
    const out = resolveBlockingRefs(new Map([['B1', full.get('B1')!]]), full, edges, joins);
    expect(out.get('B1')?.blockingRef).toBe('A1');
  });

  it('ref thật và các lý do khác giữ nguyên, không sao chép thừa', () => {
    const full = new Map([
      ['X', row('2026-01-05', '2026-01-05', 'resource', 'R-1')],
      ['Y', row('2026-01-06', '2026-01-06', 'dependency', 'X')],
    ]);
    const out = resolveBlockingRefs(full, full, [], joins);
    expect(out.get('X')).toBe(full.get('X'));
    expect(out.get('Y')?.blockingRef).toBe('X');
  });

  it('không lần ra được → null, không để lọt khoá ảo', () => {
    const full = new Map([
      [JOIN, row('2026-01-05', '2026-01-05')],
      ['B1', row('2026-01-06', '2026-01-06', 'dependency', JOIN)],
    ]);
    const out = resolveBlockingRefs(new Map([['B1', full.get('B1')!]]), full, [], joins);
    expect(out.get('B1')?.blockingRef).toBeNull();
  });
});
