import type { JSX } from 'react';

export interface WbsEmptyProps {
  /** §10.6 `edit_wbs`. Thiếu quyền thì chỉ còn đường import, do người khác làm. */
  readonly canEdit: boolean;
  readonly busy?: boolean;
  readonly onCreateFirst: () => void;
}

/**
 * Dự án chưa có task nào.
 *
 * Trước đây chỗ này chỉ in một câu "Import a task list to start", và đó là một ngõ cụt:
 * cây WBS không được render nên không có dòng nào để rê chuột, mà nút `+child` / `+after`
 * chỉ hiện khi rê chuột lên một dòng. Dựng WBS bằng tay vì thế là bất khả thi — buộc phải
 * import một file trước, kể cả khi chỉ muốn gõ vài dòng.
 */
export function WbsEmpty({ canEdit, busy = false, onCreateFirst }: WbsEmptyProps): JSX.Element {
  return (
    <div className="app__state app__state--empty">
      <p>This project has no tasks yet.</p>
      {canEdit ? (
        <>
          <button
            type="button"
            className="app__action app__action--primary"
            disabled={busy}
            onClick={onCreateFirst}
          >
            Add the first task
          </button>
          <p>Or import a task list.</p>
        </>
      ) : (
        <p>Import a task list to start.</p>
      )}
    </div>
  );
}
