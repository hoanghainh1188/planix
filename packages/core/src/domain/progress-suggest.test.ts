import { describe, expect, it } from 'vitest';
import {
  suggestProgress,
  validateProgressEntry,
  type ProgressEntry,
  type SuggestInput,
} from './progress-suggest.js';

function input(over: Partial<SuggestInput> = {}): SuggestInput {
  return {
    planStart: '2026-03-02',
    planEnd: '2026-03-06',
    statusDate: '2026-03-04',
    isMicro: false,
    durationDays: 5,
    elapsedWorkingDays: 2,
    ...over,
  };
}

// ── §10.5 bảng đề xuất ──────────────────────────────────────────────────────

describe('đề xuất cho TASK THƯỜNG (§10.5)', () => {
  it('plan_end < status_date → done, 100%, actual lấy theo plan', () => {
    const s = suggestProgress(input({ planEnd: '2026-03-03', statusDate: '2026-03-10' }));
    expect(s.status).toBe('done');
    expect(s.percent).toBe(100);
    expect(s.actualStart).toBe('2026-03-02');
    expect(s.actualEnd).toBe('2026-03-03');
  });

  it('đang chạy → in_progress, % theo tỷ lệ thời gian ĐÃ trôi', () => {
    // 5 ngày công, đã trôi 2 → 40%.
    const s = suggestProgress(input({ durationDays: 5, elapsedWorkingDays: 2 }));
    expect(s.status).toBe('in_progress');
    expect(s.percent).toBe(40);
    expect(s.actualStart).toBe('2026-03-02');
    expect(s.actualEnd).toBeNull();
  });

  it('đúng NGÀY bắt đầu thì 0%, không phải đã làm được một ngày', () => {
    const s = suggestProgress(input({ statusDate: '2026-03-02', elapsedWorkingDays: 0 }));
    expect(s.status).toBe('in_progress');
    expect(s.percent).toBe(0);
  });

  it('ngày cuối cùng chưa xong thì chưa phải 100%', () => {
    const s = suggestProgress(input({ statusDate: '2026-03-06', elapsedWorkingDays: 4 }));
    expect(s.status).toBe('in_progress');
    expect(s.percent).toBe(80);
  });

  it('plan_start > status_date → not_started, 0%, không có actual', () => {
    const s = suggestProgress(input({ planStart: '2026-04-01', planEnd: '2026-04-10' }));
    expect(s.status).toBe('not_started');
    expect(s.percent).toBe(0);
    expect(s.actualStart).toBeNull();
    expect(s.actualEnd).toBeNull();
  });

  it('% làm tròn về SỐ NGUYÊN — đề xuất không nên tỏ ra chính xác hơn thực chất', () => {
    const s = suggestProgress(input({ durationDays: 3, elapsedWorkingDays: 1 }));
    expect(s.percent).toBe(33);
  });

  it('mốc thuần (duration 0) không chia cho 0', () => {
    const s = suggestProgress(input({ durationDays: 0, elapsedWorkingDays: 0 }));
    expect(Number.isFinite(s.percent)).toBe(true);
    expect(s.percent).toBe(0);
  });
});

describe('đề xuất cho MICRO TASK (§10.5, §7.9)', () => {
  it('đã qua hạn → done', () => {
    const s = suggestProgress(
      input({ isMicro: true, planEnd: '2026-03-03', statusDate: '2026-03-10' }),
    );
    expect(s.status).toBe('done');
    expect(s.percent).toBe(100);
  });

  it('ĐANG chạy vẫn đề xuất not_started — micro task không có in_progress', () => {
    const s = suggestProgress(input({ isMicro: true }));
    expect(s.status).toBe('not_started');
    expect(s.percent).toBe(0);
  });

  it('chưa tới hạn → not_started', () => {
    const s = suggestProgress(
      input({ isMicro: true, planStart: '2026-04-01', planEnd: '2026-04-02' }),
    );
    expect(s.status).toBe('not_started');
  });

  it('micro task không bao giờ đề xuất % lẻ — chỉ 0 hoặc 100', () => {
    for (const elapsed of [0, 1, 2, 3, 4]) {
      const s = suggestProgress(input({ isMicro: true, elapsedWorkingDays: elapsed }));
      expect([0, 100]).toContain(s.percent);
    }
  });
});

describe('task chưa xếp lịch', () => {
  it('không có ngày kế hoạch thì không đoán bừa', () => {
    const s = suggestProgress(input({ planStart: null, planEnd: null }));
    expect(s.status).toBe('not_started');
    expect(s.percent).toBe(0);
    expect(s.actualStart).toBeNull();
  });
});

// ── §10.5 ràng buộc nhập liệu ───────────────────────────────────────────────

function entry(over: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    status: 'in_progress',
    percent: 50,
    actualStart: '2026-03-02',
    actualEnd: null,
    blockedNote: null,
    isMicro: false,
    statusDate: '2026-03-10',
    ...over,
  };
}

describe('ràng buộc nhập liệu — chặn TẠI Ô (§10.5)', () => {
  it('actual_end trước actual_start bị chặn', () => {
    const errs = validateProgressEntry(
      entry({ status: 'done', actualStart: '2026-03-05', actualEnd: '2026-03-02' }),
    );
    expect(errs.map((e) => e.field)).toContain('actualEnd');
  });

  it('actual_end BẰNG actual_start là hợp lệ — task một ngày', () => {
    const errs = validateProgressEntry(
      entry({ status: 'done', actualStart: '2026-03-05', actualEnd: '2026-03-05', percent: 100 }),
    );
    expect(errs).toEqual([]);
  });

  it('actual_start sau status_date bị chặn — không khai việc ở tương lai', () => {
    const errs = validateProgressEntry(entry({ actualStart: '2026-03-20' }));
    expect(errs.map((e) => e.field)).toContain('actualStart');
  });

  it('actual_start ĐÚNG status_date là hợp lệ', () => {
    expect(validateProgressEntry(entry({ actualStart: '2026-03-10' }))).toEqual([]);
  });

  it('actual_end SAU status_date KHÔNG bị chặn — §10.5 chỉ nêu actual_start', () => {
    // Có vẻ nên chặn, nhưng spec không nói vậy và CLAUDE.md §8 cấm tự thêm luật.
    // Đã hỏi PM; nếu PM đồng ý chặn thì thêm luật kèm test, không sửa lén ở đây.
    const errs = validateProgressEntry(
      entry({ status: 'done', actualStart: '2026-03-01', actualEnd: '2026-03-20', percent: 100 }),
    );
    expect(errs).toEqual([]);
  });

  it('blocked mà thiếu ghi chú bị chặn', () => {
    const errs = validateProgressEntry(entry({ status: 'blocked', blockedNote: null }));
    expect(errs.map((e) => e.field)).toContain('blockedNote');
  });

  it('blocked có ghi chú toàn khoảng trắng vẫn là thiếu', () => {
    const errs = validateProgressEntry(entry({ status: 'blocked', blockedNote: '   ' }));
    expect(errs.map((e) => e.field)).toContain('blockedNote');
  });

  it('blocked có ghi chú thật thì qua', () => {
    const errs = validateProgressEntry(
      entry({ status: 'blocked', blockedNote: 'Waiting for client API key' }),
    );
    expect(errs).toEqual([]);
  });

  it('micro task KHÔNG được in_progress (§7.9)', () => {
    const errs = validateProgressEntry(entry({ isMicro: true, status: 'in_progress' }));
    expect(errs.map((e) => e.field)).toContain('status');
  });

  it('micro task KHÔNG được blocked (§7.9)', () => {
    const errs = validateProgressEntry(
      entry({ isMicro: true, status: 'blocked', blockedNote: 'x' }),
    );
    expect(errs.map((e) => e.field)).toContain('status');
  });

  it('micro task done/not_started/cancelled đều hợp lệ', () => {
    for (const status of ['done', 'not_started', 'cancelled'] as const) {
      const done = status === 'done';
      const errs = validateProgressEntry(
        entry({
          isMicro: true,
          status,
          percent: done ? 100 : 0,
          // `done` vẫn phải có ngày xong — luật đó không chừa micro task.
          actualEnd: done ? '2026-03-05' : null,
        }),
      );
      expect(errs).toEqual([]);
    }
  });

  it('percent ngoài 0..100 bị chặn', () => {
    expect(validateProgressEntry(entry({ percent: 120 })).map((e) => e.field)).toContain('percent');
    expect(validateProgressEntry(entry({ percent: -5 })).map((e) => e.field)).toContain('percent');
  });

  it('done mà actual_end trống bị chặn — xong thì phải có ngày xong', () => {
    const errs = validateProgressEntry(entry({ status: 'done', percent: 100, actualEnd: null }));
    expect(errs.map((e) => e.field)).toContain('actualEnd');
  });

  it('gom ĐỦ mọi lỗi cùng lúc, không dừng ở lỗi đầu', () => {
    const errs = validateProgressEntry(
      entry({ status: 'blocked', blockedNote: null, percent: 200, actualStart: '2026-12-01' }),
    );
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it('in_progress KHÔNG được 100% — §7.11 sẽ tính remaining_md = 0 cho việc chưa xong', () => {
    const errs = validateProgressEntry(entry({ status: 'in_progress', percent: 100 }));
    expect(errs.map((e) => e.field)).toContain('percent');
  });

  it('in_progress 99% thì vẫn hợp lệ', () => {
    expect(validateProgressEntry(entry({ status: 'in_progress', percent: 99 }))).toEqual([]);
  });

  it('done 100% tất nhiên hợp lệ — luật chỉ nhắm vào in_progress', () => {
    const errs = validateProgressEntry(
      entry({ status: 'done', percent: 100, actualEnd: '2026-03-05' }),
    );
    expect(errs).toEqual([]);
  });

  it('dòng hợp lệ trả về mảng rỗng', () => {
    expect(validateProgressEntry(entry())).toEqual([]);
  });
});
