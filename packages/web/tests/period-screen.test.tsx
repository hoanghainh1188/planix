/**
 * S7 — Reports & close period.
 *
 * Lớp test này sinh ra vì ĐÚNG màn này đã hỏng hai lần theo cùng một kiểu, và không test
 * nào bắt được: `useState(prop)` chỉ đọc giá trị khởi tạo MỘT lần, nên khi dữ liệu tới
 * sau (nó là một truy vấn riêng) thì ô nhập vẫn giữ giá trị cũ.
 *
 * Hậu quả thật đã gặp: đổi sang dự án khác mà ô ngày vẫn là `status_date` của dự án
 * trước, và ô tên vẫn đề tên baseline của dự án trước. Bấm Close period là chốt một mốc
 * với ngày sai và tên sai — và cả hai đều trông hoàn toàn bình thường trên màn hình.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodScreen } from '../src/components/period/PeriodScreen.js';

function setup(over: Partial<Parameters<typeof PeriodScreen>[0]> = {}) {
  const props = {
    statusDate: '2026-03-02',
    baselines: [],
    closing: false,
    closeResult: null,
    onClose: vi.fn().mockResolvedValue(undefined),
    downloading: null,
    downloadError: null,
    onDownload: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const view = render(<PeriodScreen {...props} />);
  return { ...view, props };
}

/**
 * Thu hẹp kiểu bằng KIỂM TRA lúc chạy, không bằng `as`.
 *
 * `getByRole` trả `HTMLElement`, mà `.disabled` chỉ có trên phần tử form. Ép kiểu thì
 * eslint gỡ mất (`no-unnecessary-type-assertion`) rồi `tsc` lại đỏ. `instanceof` làm cả
 * hai vừa lòng, và nếu vai trò đổi thì test hỏng ngay tại chỗ.
 */
function asButton(el: HTMLElement): HTMLButtonElement {
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Không phải button: ${el.tagName}`);
  return el;
}

function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error(`Không phải input: ${el.tagName}`);
  return el;
}

const dateInput = (): HTMLInputElement => asInput(screen.getByLabelText('Status date'));
const labelInput = (): HTMLInputElement => asInput(screen.getByLabelText('Baseline name'));

describe('S7 — ô nhập bám theo dữ liệu cho tới khi PM tự gõ', () => {
  it('hiện status date của dự án', () => {
    setup();
    expect(dateInput().value).toBe('2026-03-02');
  });

  /**
   * Đây là bug đã xảy ra, lần thứ nhất.
   *
   * `statusDate` tới SAU lần render đầu (nó là một truy vấn riêng). Với `useState(prop)`
   * thì ô sẽ mãi giữ giá trị rỗng ban đầu.
   */
  it('dữ liệu tới muộn thì ô phải cập nhật theo', () => {
    const { rerender, props } = setup({ statusDate: '' });
    expect(dateInput().value).toBe('');

    rerender(<PeriodScreen {...props} statusDate="2026-03-02" />);
    expect(dateInput().value).toBe('2026-03-02');
  });

  /**
   * Bug đã xảy ra, lần thứ hai — và là lần nguy hiểm hơn.
   *
   * Đổi sang dự án khác: ngày phải đổi theo. Giữ ngày của dự án cũ nghĩa là chốt kỳ với
   * một mốc chuẩn không thuộc dự án này.
   */
  it('đổi dự án thì ngày đổi theo, không giữ của dự án trước', () => {
    const { rerender, props } = setup({ statusDate: '2026-03-02' });
    rerender(<PeriodScreen {...props} statusDate="2026-09-14" />);
    expect(dateInput().value).toBe('2026-09-14');
  });

  /** Tên baseline gợi ý theo SỐ baseline đã có — cũng là dữ liệu tới sau. */
  it('đổi dự án thì tên gợi ý đổi theo số baseline của dự án mới', () => {
    const { rerender, props } = setup({ baselines: [] });
    const first = labelInput().value;

    rerender(
      <PeriodScreen
        {...props}
        baselines={[
          {
            id: 'B-1',
            label: 'Plan v1.0',
            statusDate: '2026-01-05',
            takenAt: '2026-01-05T00:00:00.000Z',
          },
          {
            id: 'B-2',
            label: 'Plan v1.1',
            statusDate: '2026-02-05',
            takenAt: '2026-02-05T00:00:00.000Z',
          },
        ]}
      />,
    );
    expect(labelInput().value).not.toBe(first);
  });

  /**
   * Mặt còn lại của mẫu "bản nháp thắng dữ liệu suy ra": một khi PM đã gõ, dữ liệu tới
   * sau KHÔNG được giẫm lên. Thiếu vế này thì chữ đang gõ dở bị xoá giữa chừng.
   */
  it('PM đã gõ rồi thì dữ liệu tới sau không giẫm lên', async () => {
    const user = userEvent.setup();
    const { rerender, props } = setup({ statusDate: '2026-03-02' });

    await user.clear(dateInput());
    await user.type(dateInput(), '2026-06-30');
    expect(dateInput().value).toBe('2026-06-30');

    rerender(<PeriodScreen {...props} statusDate="2026-09-14" />);
    expect(dateInput().value, 'ngày PM tự gõ phải được giữ').toBe('2026-06-30');
  });

  it('gửi đúng ngày và tên đang hiện khi bấm Close period', async () => {
    const user = userEvent.setup();
    const { props } = setup({ statusDate: '2026-03-02' });

    await user.click(screen.getByRole('button', { name: 'Close period' }));
    expect(props.onClose).toHaveBeenCalledWith('2026-03-02', expect.any(String));
  });

  it('đang chốt thì khoá nút lại, không cho bấm hai lần', () => {
    setup({ closing: true });
    expect(asButton(screen.getByRole('button', { name: 'Closing…' })).disabled).toBe(true);
  });
});

describe('S7 — §7.13 dừng hẳn khi có Critical', () => {
  /**
   * Khác mọi đường ghi khác (§12.4 cho ghi rồi báo). Baseline là mốc cam kết; dựng nó
   * trên dữ liệu hỏng là làm hỏng chính thước đo — nên PM phải ĐỌC được danh sách.
   */
  it('liệt kê issue Critical, bỏ qua mức thấp hơn', () => {
    setup({
      closeResult: {
        ok: false,
        message: 'Cannot close: the project has blocking issues.',
        issues: [
          { code: 'C05', severity: 'Critical', message: 'Cycle detected' },
          { code: 'N03', severity: 'Minor', message: 'Leaf has no phase' },
        ],
      } as never,
    });

    expect(screen.getByRole('alert').textContent).toContain('C05');
    expect(screen.getByRole('alert').textContent).not.toContain('N03');
  });
});

/**
 * §10.6 cho lead bản `full` và CHỈ bản đó, nhưng không cho chốt kỳ.
 *
 * Trước PR này lead không có cửa nào tới màn Reports — server và MCP đều cho họ xuất bản
 * `full`, riêng UI thì giấu cả màn vì màn này còn chứa Close period. Cách mở là tách quyền
 * BÊN TRONG màn, không phải mở toang cả màn.
 */
describe('S7 — lead lấy được báo cáo nhưng không chốt kỳ được', () => {
  function asLead(over: Partial<Parameters<typeof PeriodScreen>[0]> = {}) {
    const props = {
      statusDate: '2026-03-02',
      baselines: [],
      closing: false,
      closeResult: null,
      downloading: null,
      downloadError: null,
      onDownload: vi.fn().mockResolvedValue(undefined),
      // KHÔNG có `onClose` — đó là cách màn này biết người xem không được chốt kỳ.
      reports: ['full'] as const,
      ...over,
    };
    return { ...render(<PeriodScreen {...props} />), props };
  }

  it('không còn phần chốt kỳ', () => {
    asLead();
    expect(screen.queryByRole('button', { name: 'Close period' })).toBeNull();
    expect(screen.queryByLabelText('Status date')).toBeNull();
    expect(screen.queryByLabelText('Baseline name')).toBeNull();
  });

  it('tiêu đề không hứa việc họ không làm được', () => {
    asLead();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reports');
  });

  it('chỉ còn bản full, không có summary hay resource', () => {
    asLead();
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.queryByText('Resource matrix')).toBeNull();
  });

  it('tải được bản full', async () => {
    const user = userEvent.setup();
    const { props } = asLead();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownload).toHaveBeenCalledWith('full', expect.any(Number));
  });

  /** Baseline là dữ liệu đọc (`view_assigned_project`) — lead vẫn cần thấy mốc đang đo. */
  it('vẫn thấy danh sách baseline', () => {
    asLead({
      baselines: [
        {
          id: 'B-1',
          label: 'Plan v1.0',
          statusDate: '2026-01-05',
          takenAt: '2026-01-05T00:00:00.000Z',
        },
      ],
    });
    expect(screen.getByText('Plan v1.0')).toBeTruthy();
  });

  /** Mặt còn lại: PM vẫn đủ cả ba bản và phần chốt kỳ. */
  it('PM vẫn có đủ ba bản và nút chốt kỳ', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Close period' })).toBeTruthy();
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Resource matrix')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reports & close period');
  });
});
