import type { JSX } from 'react';

export interface HeaderActionsProps {
  /** §10.6 `recalculate_project` — `{pm: true, lead: false}`. */
  readonly canRecalculate: boolean;
  /** Đang chạy thử lịch: khoá nút và đổi nhãn. */
  readonly busy?: boolean;
  /** Dự án chưa có task thì không có gì để xếp. */
  readonly hasTasks: boolean;
  readonly onRecalculate: () => void;
  readonly onSignOut: () => void;
}

/**
 * Hai nút bên phải thanh trên cùng.
 *
 * Tách ra khỏi `App.tsx` để kiểm được luật quyền bằng test — trước đây nút Recalculate
 * hiện cho cả lead, và không có cách nào bắt được điều đó ngoài việc đăng nhập bằng một
 * tài khoản lead thật rồi nhìn bằng mắt.
 */
export function HeaderActions({
  canRecalculate,
  busy = false,
  hasTasks,
  onRecalculate,
  onSignOut,
}: HeaderActionsProps): JSX.Element {
  return (
    <div className="app__actions">
      <button type="button" className="app__action" onClick={onSignOut}>
        Sign out
      </button>
      {canRecalculate ? (
        <button
          type="button"
          className="app__action app__action--primary"
          onClick={onRecalculate}
          disabled={!hasTasks || busy}
        >
          {busy ? 'Calculating…' : 'Recalculate'}
        </button>
      ) : null}
    </div>
  );
}
