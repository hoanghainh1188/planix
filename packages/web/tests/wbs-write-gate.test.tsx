/**
 * S1 — hai lối vào đường ghi của cây WBS.
 *
 * Cả hai đều là chuyện "cái nút có ở đó không", nên không test nào của core chạm tới được:
 * server vẫn chặn đúng, engine vẫn chạy đúng, chỉ có người dùng là không tới được chỗ cần
 * tới — hoặc tới được chỗ họ không có quyền rồi ăn lỗi.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WbsEmpty } from '../src/components/wbs-tree/WbsEmpty.js';
import { WbsTree } from '../src/components/wbs-tree/WbsTree.js';
import type { WbsRow } from '../src/data/types.js';

/**
 * `WbsTree` ảo hoá danh sách: nó chỉ vẽ những dòng lọt vào khung nhìn. Trong jsdom mọi phần
 * tử cao 0px, nên khung nhìn rỗng và cây không vẽ dòng nào — test sẽ "xanh" vì không tìm
 * thấy nút, đúng cả khi nút vẫn còn đó.
 *
 * Cho khung nhìn một chiều cao thật để có dòng mà xem.
 */
function giveViewportHeight(): void {
  // `@tanstack/react-virtual` đo khung nhìn bằng `offsetWidth` / `offsetHeight`, và trong
  // jsdom cả hai luôn là 0.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.classList.contains('wbs__scroll') ? 600 : 28;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(): number {
      return 1200;
    },
  });
}

function rowOf(over: Partial<WbsRow> = {}): WbsRow {
  return {
    uid: 'T-0001',
    wbsCode: '1',
    depth: 1,
    parentUid: null,
    name: 'Root',
    kind: 'summary',
    effortMd: null,
    role: null,
    childSequencing: null,
    priority: 500,
    pic: null,
    status: 'not_started',
    percent: 0,
    planStart: null,
    planEnd: null,
    totalFloat: null,
    isCritical: false,
    delayReason: null,
    issueCodes: [],
    linkCount: 0,
    ...over,
  };
}

describe('dự án rỗng vẫn dựng được WBS bằng tay', () => {
  /**
   * Bug đã có thật: màn rỗng chỉ in "Import a task list to start" và KHÔNG render cây, nên
   * không có dòng nào để rê chuột — mà `+child` / `+after` chỉ hiện khi rê chuột. Muốn gõ
   * tay vài dòng cũng buộc phải import một file trước.
   */
  it('PM thấy lối tạo task đầu tiên', async () => {
    const user = userEvent.setup();
    const onCreateFirst = vi.fn();
    render(<WbsEmpty canEdit onCreateFirst={onCreateFirst} />);

    await user.click(screen.getByRole('button', { name: 'Add the first task' }));
    expect(onCreateFirst).toHaveBeenCalledTimes(1);
  });

  it('đang ghi thì khoá nút, không cho bấm hai lần', () => {
    const el = screen.queryByRole('button');
    expect(el).toBeNull();
    render(<WbsEmpty canEdit busy onCreateFirst={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Add the first task' });
    if (!(btn instanceof HTMLButtonElement)) throw new Error('Không phải button');
    expect(btn.disabled).toBe(true);
  });

  /** §10.6: lead không có `edit_wbs` — không được mời làm việc mình không làm được. */
  it('người không có quyền sửa thì không thấy nút nào', () => {
    render(<WbsEmpty canEdit={false} onCreateFirst={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Import a task list/)).toBeTruthy();
  });
});

describe('§10.6 — thiếu edit_wbs thì cây chỉ để xem', () => {
  const rows = [
    rowOf(),
    rowOf({
      uid: 'T-0002',
      wbsCode: '1.1',
      depth: 2,
      parentUid: 'T-0001',
      name: 'Child',
      kind: 'work',
    }),
  ];

  it('có quyền thì hiện đủ nút thêm và xoá', () => {
    giveViewportHeight();
    render(
      <WbsTree
        projectId="P-1"
        rows={rows}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getAllByTitle('Add a task right after this one').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/^Delete this task/).length).toBeGreaterThan(0);
  });

  /**
   * Đây mới là vế quan trọng. `WbsTree` đã có sẵn chế độ chỉ-xem (vắng callback là tắt),
   * nhưng `App.tsx` truyền callback vô điều kiện nên chế độ đó chưa từng được dùng. Nếu
   * component âm thầm vẫn vẽ nút khi vắng callback thì cái gate ở `App.tsx` là vô nghĩa.
   */
  it('không có quyền thì không còn nút ghi nào', () => {
    giveViewportHeight();
    render(<WbsTree projectId="P-1" rows={rows} />);
    // Cây PHẢI có dòng, nếu không thì "không tìm thấy nút" chẳng chứng minh được gì.
    expect(screen.getByText('Child')).toBeTruthy();
    expect(screen.queryByTitle('Add a task right after this one')).toBeNull();
    expect(screen.queryByTitle('Add a task inside this one')).toBeNull();
    expect(screen.queryByTitle(/^Delete this task/)).toBeNull();
  });
});
