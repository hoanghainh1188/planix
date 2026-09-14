/**
 * S2 — Task detail.
 *
 * Panel này sửa được nhóm nhãn phân loại (PM chốt 2026-09-14). Nó dùng cùng mẫu "bản nháp
 * thắng dữ liệu suy ra" như S7, nên nó thừa hưởng cùng rủi ro — và đây là chỗ khoá lại.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDetailPanel } from '../src/components/detail/TaskDetailPanel.js';

type Link = {
  taskUid: string;
  wbsCode: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  reason: string | null;
  ref: string | null;
  refLabel: string | null;
};

function link(over: Partial<Link> = {}): Link {
  return {
    taskUid: 'T-1',
    wbsCode: '1.1',
    name: 'Thiết kế',
    startDate: '2026-01-05',
    endDate: '2026-01-06',
    reason: null,
    ref: null,
    refLabel: null,
    ...over,
  };
}

function detailOf(over: Record<string, unknown> = {}, chain: Link[] = []) {
  return {
    task: {
      uid: 'T-1',
      wbsCode: '1.1',
      depth: 2,
      parentUid: 'T-0',
      name: 'Thiết kế',
      kind: 'work',
      effortMd: 2,
      role: 'Dev',
      category: null,
      phase: 'design',
      module: 'core',
      childSequencing: null,
      priority: 500,
      constraintType: null,
      constraintDate: null,
      status: 'not_started',
      percent: 0,
      actualStart: null,
      actualEnd: null,
      assigneeId: 'R-1',
      assigneeName: 'An',
      allocation: 1,
      isPinned: false,
      startDate: '2026-01-05',
      endDate: '2026-01-06',
      totalFloat: 0,
      isCritical: true,
      isResourceCritical: false,
      description: null,
      externalRef: null,
      ...over,
    },
    dependencies: { predecessors: [], successors: [] },
    explanation: { taskUid: 'T-1', chain, truncated: false },
  } as never;
}

function setup(over: Partial<Parameters<typeof TaskDetailPanel>[0]> = {}) {
  const props = {
    detail: detailOf(),
    loading: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    busy: false,
    ...over,
  };
  const view = render(<TaskDetailPanel {...props} />);
  return { ...view, props };
}

/**
 * Thu hẹp kiểu bằng KIỂM TRA lúc chạy, không bằng `as`.
 *
 * `getByRole` trả `HTMLElement`, mà `.disabled` chỉ có trên phần tử form. Ép kiểu thì
 * eslint gỡ mất (`no-unnecessary-type-assertion`) rồi `tsc` lại đỏ. `instanceof` làm cả
 * hai vừa lòng, và nếu vai trò đổi thì test hỏng ngay tại chỗ thay vì hỏng ở một khẳng
 * định khó hiểu phía dưới.
 */
function asButton(el: HTMLElement): HTMLButtonElement {
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Không phải button: ${el.tagName}`);
  return el;
}

function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error(`Không phải input: ${el.tagName}`);
  return el;
}

const phaseBox = (): HTMLInputElement => asInput(screen.getByLabelText(/^Phase/));
const saveBtn = (): HTMLButtonElement =>
  asButton(screen.getByRole('button', { name: /^(Save|Saving…)$/ }));

describe('S2 — hiển thị', () => {
  it('hiện mã, tên và các con số của task', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Thiết kế' })).toBeTruthy();
    expect(screen.getByText('1.1')).toBeTruthy();
    expect(screen.getByText('2 MD')).toBeTruthy();
  });

  /** Ghim chỉ sửa được qua import hoặc MCP — nhưng PM phải THẤY nó đang có. */
  it('hiện nhãn ghim khi task bị ghim người', () => {
    setup({ detail: detailOf({ isPinned: true }) });
    expect(screen.getByText(/pinned to An/)).toBeTruthy();
  });

  /**
   * §10.6 — lead xem được, không sửa được. Thiếu `onSave` thì panel chỉ để đọc, và
   * KHÔNG được hiện ô nhập nào.
   */
  it('không có onSave thì chỉ đọc, không có ô nhập', () => {
    render(<TaskDetailPanel detail={detailOf()} loading={false} />);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText(/^Phase/)).toBeNull();
  });
});

describe('S2 — bản nháp', () => {
  it('chưa gõ gì thì Save khoá', () => {
    setup();
    expect(saveBtn().disabled).toBe(true);
  });

  it('gõ rồi thì Save mở, và gửi đúng giá trị', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.clear(phaseBox());
    await user.type(phaseBox(), 'build');
    expect(saveBtn().disabled).toBe(false);

    await user.click(saveBtn());
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'build', module: 'core' }),
    );
  });

  /**
   * Xoá trắng một ô phải gửi `null`, không phải chuỗi rỗng.
   *
   * `phase = ''` và `phase = NULL` khác nhau với SQL nhưng cùng nghĩa "chưa đặt" với
   * người dùng, và `N03` chỉ kiểm `NULL`. Server cũng quy về `null`, nhưng khoá cả hai
   * đầu thì không phụ thuộc vào việc nhớ ra điều đó ở một nơi duy nhất.
   */
  it('xoá trắng ô thì gửi null', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.clear(phaseBox());
    await user.click(saveBtn());
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ phase: null }));
  });

  it('Cancel trả ô về giá trị đã lưu', async () => {
    const user = userEvent.setup();
    setup();

    await user.clear(phaseBox());
    await user.type(phaseBox(), 'nháp');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(phaseBox().value).toBe('design');
  });

  /**
   * Dữ liệu tới sau KHÔNG được giẫm lên chữ PM đang gõ dở — mặt còn lại của mẫu bản nháp,
   * và là thứ đã hỏng hai lần ở S7.
   */
  it('dữ liệu tới sau không giẫm lên chữ đang gõ', async () => {
    const user = userEvent.setup();
    const { rerender, props } = setup();

    await user.clear(phaseBox());
    await user.type(phaseBox(), 'đang gõ');

    rerender(<TaskDetailPanel {...props} detail={detailOf({ phase: 'từ-server' })} />);
    expect(phaseBox().value).toBe('đang gõ');
  });

  it('đang lưu thì khoá ô và nút', () => {
    setup({ busy: true });
    expect(phaseBox().disabled).toBe(true);
    expect(saveBtn().disabled).toBe(true);
  });
});

describe('S2 — chuỗi chặn (§7.6)', () => {
  /** Chuỗi một mắt là chính nó — không có gì để giải thích, nên không hiện khối đó. */
  it('chuỗi chỉ có chính nó thì không hiện khối giải thích', () => {
    setup();
    expect(screen.queryByRole('heading', { name: 'Why it starts here' })).toBeNull();
  });

  it('chuỗi dài hơn một mắt thì hiện, kèm lý do', () => {
    setup({
      detail: {
        ...(detailOf() as Record<string, unknown>),
        explanation: {
          taskUid: 'T-1',
          truncated: false,
          chain: [
            {
              taskUid: 'T-1',
              wbsCode: '1.1',
              name: 'Thiết kế',
              startDate: null,
              endDate: null,
              reason: 'dependency',
              ref: 'T-2',
            },
            {
              taskUid: 'T-2',
              wbsCode: '1.2',
              name: 'Chuẩn bị',
              startDate: null,
              endDate: null,
              reason: 'cross_project',
              ref: 'P-UTG',
            },
          ],
        },
      } as never,
    });

    expect(screen.getByRole('heading', { name: 'Why it starts here' })).toBeTruthy();
    // Mắt không phải dependency thì `ref` là dự án hoặc người — phải hiện ra.
    expect(screen.getByText(/cross_project · P-UTG/)).toBeTruthy();
  });
});

/**
 * §7.6 — vì sao task nằm ở chỗ nó đang nằm.
 *
 * Bug đã có thật: khối giải thích chỉ hiện khi chuỗi dài hơn MỘT mắt, tức chỉ khi task chờ
 * task khác. Chờ người hay bị dự án khác chiếm chỗ thì chuỗi đúng một mắt, và khối biến
 * mất. Trên `data/dev.db` là 299/744 task — đúng những task PM khó tự đoán ra nhất.
 */
describe('S2 — lý do bắt đầu muộn (§7.6)', () => {
  const why = (): string => screen.getByText(/./, { selector: '.detail__why' }).textContent ?? '';

  it('chờ người: hiện dù chuỗi chỉ một mắt, và gọi TÊN người', () => {
    setup({
      detail: detailOf({}, [link({ reason: 'resource', ref: 'R-03', refLabel: 'Pham D' })]),
    });
    expect(why()).toContain('Pham D');
    expect(why()).not.toContain('R-03');
  });

  it('bị dự án khác chiếm chỗ: hiện dù chuỗi chỉ một mắt, và gọi MÃ dự án', () => {
    setup({
      detail: detailOf({}, [link({ reason: 'cross_project', ref: 'P-UTG', refLabel: 'UTG' })]),
    });
    expect(why()).toContain('UTG');
    expect(why()).not.toContain('P-UTG');
  });

  it('không có gì đẩy: vẫn nói ra, không để trống', () => {
    setup({ detail: detailOf({}, [link({ reason: null })]) });
    expect(why()).toMatch(/earliest date allowed/);
  });

  it('chờ task đứng trước: câu dẫn cộng cả chuỗi', () => {
    setup({
      detail: detailOf({}, [
        link({ reason: 'dependency', ref: 'T-0', refLabel: '1.0' }),
        link({
          taskUid: 'T-0',
          wbsCode: '1.0',
          name: 'Khảo sát',
          reason: 'resource',
          ref: 'R-1',
          refLabel: 'An',
        }),
      ]),
    });
    expect(why()).toContain('1.0');
    expect(screen.getByText('Khảo sát')).toBeTruthy();
    // Mắt cuối không phải dependency thì in tên, không in khoá.
    expect(screen.getByText(/resource · An/)).toBeTruthy();
  });

  it('chưa xếp lịch lần nào: không có khối', () => {
    setup({ detail: detailOf({}, []) });
    expect(screen.queryByText('Why it starts here')).toBeNull();
  });

  it('thứ ref trỏ tới đã không còn: rơi về khoá, không in "null"', () => {
    setup({ detail: detailOf({}, [link({ reason: 'resource', ref: 'R-GONE', refLabel: null })]) });
    expect(why()).toContain('R-GONE');
    expect(why()).not.toContain('null');
  });
});
