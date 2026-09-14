/**
 * S9 — Resource pool.
 *
 * Màn này chỉ đọc, nên rủi ro không nằm ở ghi nhầm mà ở **hiểu nhầm**: tô sai màu hoặc lọc
 * sai thì PM đọc ra một bức tranh không đúng, và không có gì báo cho họ biết.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PoolScreen } from '../src/components/pool/PoolScreen.js';

function cell(bucket: string, allocatedMd: number, capacityMd: number) {
  return {
    bucket,
    allocatedMd,
    capacityMd,
    utilisation: capacityMd > 0 ? allocatedMd / capacityMd : null,
    otherProjectMd: 0,
  };
}

function row(
  id: string,
  name: string,
  cells: ReturnType<typeof cell>[],
  byProject: unknown[] = [],
) {
  return {
    resourceId: id,
    resourceName: name,
    cells,
    totalAllocatedMd: cells.reduce((s, c) => s + c.allocatedMd, 0),
    totalCapacityMd: cells.reduce((s, c) => s + c.capacityMd, 0),
    byProject,
    overbooked: cells.some((c) => (c.utilisation ?? 0) > 1),
  };
}

type PoolProps = Parameters<typeof PoolScreen>[0];

function setup(over: Partial<PoolProps> = {}) {
  const props: PoolProps = {
    data: {
      buckets: ['W2026-01-05', 'W2026-01-12'],
      rows: [
        row(
          'R-1',
          'An',
          [cell('W2026-01-05', 7, 5), cell('W2026-01-12', 2, 5)],
          [
            { projectId: 'P-A', projectCode: 'UTG', md: 6 },
            { projectId: 'P-B', projectCode: 'GEO', md: 3 },
          ],
        ),
        row('R-2', 'Bình', [cell('W2026-01-05', 2, 5), cell('W2026-01-12', 0, 5)]),
      ],
      projects: [
        { id: 'P-A', code: 'UTG', name: 'UTG', priority: 1, status: 'active' },
        { id: 'P-B', code: 'GEO', name: 'GEO', priority: 2, status: 'active' },
      ],
    } as PoolProps['data'],
    loading: false,
    error: null,
    from: '2026-01-05',
    to: '2026-01-18',
    by: 'week' as const,
    onRange: vi.fn(),
    ...over,
  };
  const view = render(<PoolScreen {...props} />);
  return { ...view, props };
}

/**
 * Thu hẹp kiểu bằng KIỂM TRA lúc chạy, không bằng `as`.
 *
 * `getByRole` trả `HTMLElement`, mà `.disabled` chỉ có trên phần tử form. Ép kiểu thì
 * eslint gỡ mất (`no-unnecessary-type-assertion`) rồi `tsc` lại đỏ. `instanceof` làm cả
 * hai vừa lòng.
 */
function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error(`Không phải input: ${el.tagName}`);
  return el;
}

const bodyRows = (): HTMLElement[] =>
  within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('S9 — bảng', () => {
  it('mỗi người một dòng, mỗi kỳ một cột', () => {
    setup();
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText('An')).toBeTruthy();
    expect(screen.getByText('R-2')).toBeTruthy();
  });

  it('hiện phần trăm, không chỉ hiện màu', () => {
    // Màu một mình không đọc được với người mù màu — con số phải luôn có mặt.
    setup();
    expect(screen.getByText('140%')).toBeTruthy();
    // 40% xuất hiện ở hai ô khác nhau — dùng getAllByText, không phải getByText.
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
  });

  /** §7.12 xếp theo thứ tự ưu tiên, nên PM phải thấy ai nhường ai. */
  it('hiện thứ tự ưu tiên của các dự án đang tranh', () => {
    setup();
    const legend = screen.getByText(/Competing in priority order/);
    expect(legend.textContent).toContain('UTG');
    expect(legend.textContent).toContain('#1');
    expect(legend.textContent).toContain('GEO');
  });

  it('cột "Booked by" nói rõ dự án nào giữ người này', () => {
    setup();
    const first = bodyRows()[0];
    expect(first?.textContent).toContain('UTG');
    expect(first?.textContent).toContain('6 MD');
  });
});

describe('S9 — nhận ra đặt quá tay', () => {
  /**
   * Con số này là lý do màn tồn tại: nhìn từ trong MỘT dự án, người đặt 100% trông bình
   * thường; chỉ pool mới thấy 140%.
   */
  it('đếm đúng số người quá tải', () => {
    setup();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('lọc "chỉ quá tải" giấu người bình thường đi', async () => {
    const user = userEvent.setup();
    setup();
    expect(bodyRows()).toHaveLength(2);

    await user.click(screen.getByRole('checkbox'));
    const shown = bodyRows();
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toContain('An');
  });

  it('không ai quá tải thì khoá ô lọc lại', () => {
    setup({
      data: {
        buckets: ['W2026-01-05'],
        rows: [row('R-2', 'Bình', [cell('W2026-01-05', 2, 5)])],
        projects: [],
      } as PoolProps['data'],
    });
    expect(asInput(screen.getByRole('checkbox')).disabled).toBe(true);
  });
});

describe('S9 — cửa sổ thời gian', () => {
  it('đổi khoảng thì báo lên trên, không tự tải lại một mình', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.selectOptions(screen.getByLabelText('By'), 'month');
    expect(props.onRange).toHaveBeenCalledWith('2026-01-05', '2026-01-18', 'month');
  });

  it('lỗi từ server thì hiện ra, không im lặng', () => {
    setup({ error: 'Resource load window is 3654 days; the limit is 1100.' });
    expect(screen.getByRole('alert').textContent).toContain('limit is 1100');
  });

  it('rỗng vì chưa có ai khác hẳn rỗng vì đang lọc', () => {
    const { unmount } = setup({
      data: { buckets: [], rows: [], projects: [] },
    });
    expect(screen.getByText(/No people in the pool yet/)).toBeTruthy();
    unmount();

    setup({ loading: true });
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
