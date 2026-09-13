import { useState, type JSX } from 'react';
import { TaskPicker } from './TaskPicker.js';
import type { DependencyType, LinkIssue, TaskLink, TaskLinks, WbsRow } from '../../data/types.js';
import './links.css';

/** §6.1 — bốn loại, đúng thứ tự spec liệt kê. */
const TYPES: ReadonlyArray<{ id: DependencyType; label: string }> = [
  { id: 'FS', label: 'FS — finish to start' },
  { id: 'SS', label: 'SS — start to start' },
  { id: 'FF', label: 'FF — finish to finish' },
  { id: 'SF', label: 'SF — start to finish' },
];

export type LinkDirection = 'before' | 'after';

export interface DependencyPanelProps {
  readonly task: WbsRow | null;
  readonly links: TaskLinks | null;
  readonly loading: boolean;
  /** Cả cây, để chọn đầu bên kia mà không phải tải thêm. */
  readonly rows: readonly WbsRow[];
  /** Phản hồi validate của lần sửa gần nhất (§12.4). */
  readonly issues: readonly LinkIssue[];
  /** Thiếu hai callback này thì panel chỉ để xem — lead xem được, không sửa được (§10.6). */
  readonly onAdd?: (
    direction: LinkDirection,
    otherUid: string,
    type: DependencyType,
    lagDays: number,
  ) => Promise<void>;
  readonly onRemove?: (direction: LinkDirection, link: TaskLink) => Promise<void>;
  readonly busy?: boolean;
}

/**
 * Đường đi của `C01` đọc được, thay cho dãy uid.
 *
 * §8.1 đòi issue vòng lặp mang ĐƯỜNG ĐI đầy đủ, và validator trả đúng thứ đó trong
 * `detail.path` — nhưng bằng `uid` (`T-0129 -> T-0256 -> T-0129`). `uid` là khoá nội bộ,
 * không xuất hiện ở bất kỳ chỗ nào khác trên màn hình, nên với PM nó là ba chuỗi vô nghĩa.
 *
 * Đổi sang mã WBS là việc của lớp hiển thị — §8.4 đã nói `message` của engine là tiếng
 * Anh và "bản dịch là việc của lớp hiển thị". Engine giữ nguyên, không đụng tới.
 */
function readablePath(
  issue: LinkIssue,
  rows: readonly WbsRow[],
): ReadonlyArray<{ uid: string; label: string }> | null {
  const path: unknown = issue.detail?.['path'];
  if (!Array.isArray(path)) return null;
  const byUid = new Map(rows.map((r) => [r.uid, r]));
  return path.map((uid, index) => {
    const id = String(uid);
    const row = byUid.get(id);
    return {
      // Cùng một task xuất hiện hai lần ở hai đầu vòng, nên uid không đủ làm khoá React.
      uid: `${id}-${String(index)}`,
      label: row === undefined ? id : `${row.wbsCode} ${row.name}`,
    };
  });
}

function lagLabel(lagDays: number): string {
  if (lagDays === 0) return 'no lag';
  // §6.1: lag âm là lead, cho phép chồng lấn. Gọi đúng tên để PM không đọc nhầm dấu.
  return lagDays > 0 ? `+${String(lagDays)}d lag` : `${String(lagDays)}d lead`;
}

export function DependencyPanel({
  task,
  links,
  loading,
  rows,
  issues,
  onAdd,
  onRemove,
  busy = false,
}: DependencyPanelProps): JSX.Element {
  const [direction, setDirection] = useState<LinkDirection>('before');
  const [other, setOther] = useState<WbsRow | null>(null);
  const [type, setType] = useState<DependencyType>('FS');
  const [lag, setLag] = useState('0');

  const canEdit = onAdd !== undefined;

  if (task === null) {
    return (
      <aside className="links" aria-label="Task links">
        <div className="links__head">
          <h2 className="links__title">Links</h2>
        </div>
        <p className="links__empty">Select a task to see what it waits for.</p>
      </aside>
    );
  }

  async function submit(): Promise<void> {
    if (other === null || onAdd === undefined) return;
    const parsed = Number.parseInt(lag, 10);
    await onAdd(direction, other.uid, type, Number.isNaN(parsed) ? 0 : parsed);
    setOther(null);
    setLag('0');
  }

  const predecessors = links?.predecessors ?? [];
  const successors = links?.successors ?? [];

  return (
    <aside className="links" aria-label="Task links">
      <div className="links__head">
        <h2 className="links__title">Links</h2>
        <p className="links__subject">
          <span className="links__code">{task.wbsCode}</span>
          <span className="links__subjectName">{task.name}</span>
        </p>
      </div>

      <div className="links__body">
        {loading ? (
          <p className="links__empty">Loading links…</p>
        ) : (
          <>
            <LinkList
              caption="Waits for"
              hint="This task cannot start until these are done."
              direction="before"
              links={predecessors}
              onRemove={onRemove}
              busy={busy}
            />
            <LinkList
              caption="Blocks"
              hint="These wait for this task."
              direction="after"
              links={successors}
              onRemove={onRemove}
              busy={busy}
            />
          </>
        )}

        {issues.length > 0 ? (
          <ul className="links__issues" role="status">
            {issues.map((issue, index) => {
              const path = readablePath(issue, rows);
              return (
                <li key={`${issue.code}-${String(index)}`} className="links__issue">
                  <span className="links__issueCode" data-severity={issue.severity}>
                    {issue.code}
                  </span>
                  {path === null ? (
                    <span>{issue.message}</span>
                  ) : (
                    <span>
                      This link closes a loop. The schedule cannot be computed until one of these
                      links is removed.
                      <span className="links__path">
                        {path.map((step) => (
                          <span key={step.uid}>{step.label}</span>
                        ))}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {canEdit ? (
          <form
            className="links__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3 className="links__formTitle">Add a link</h3>

            <div className="links__row">
              <label className="links__label" htmlFor="link-direction">
                Direction
              </label>
              <select
                id="link-direction"
                className="links__select"
                value={direction}
                disabled={busy}
                onChange={(e) => setDirection(e.target.value === 'after' ? 'after' : 'before')}
              >
                <option value="before">This task waits for…</option>
                <option value="after">This task blocks…</option>
              </select>
            </div>

            <div className="links__row">
              <span className="links__label">Task</span>
              <TaskPicker
                rows={rows}
                excludeUid={task.uid}
                value={other}
                onChange={setOther}
                disabled={busy}
              />
            </div>

            <div className="links__row links__row--split">
              <span className="links__field">
                <label className="links__label" htmlFor="link-type">
                  Type
                </label>
                <select
                  id="link-type"
                  className="links__select"
                  value={type}
                  disabled={busy}
                  onChange={(e) => setType(e.target.value as DependencyType)}
                >
                  {TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </span>
              <span className="links__field links__field--narrow">
                <label className="links__label" htmlFor="link-lag">
                  Lag (days)
                </label>
                <input
                  id="link-lag"
                  type="number"
                  className="links__number"
                  value={lag}
                  disabled={busy}
                  onChange={(e) => setLag(e.target.value)}
                />
              </span>
            </div>

            {/*
              §6.1: "SF hiếm dùng trong phần mềm, hay bị AI sinh nhầm." Spec đòi engine ghi
              N01 cho mọi cạnh SF; rule đó CHƯA có trong validator (xem
              docs/decisions/2026-09-13-validator-rules-con-thieu.md), nên chỗ này nói trước
              ngay tại nơi sai lầm xảy ra. Đây là tấm chắn tạm, không thay cho N01.
            */}
            {type === 'SF' ? (
              <p className="links__warn">SF is rarely correct. Did you mean FS?</p>
            ) : null}
            {lag.startsWith('-') ? (
              <p className="links__note">A negative lag is a lead: the two tasks overlap.</p>
            ) : null}

            <button type="submit" className="links__submit" disabled={busy || other === null}>
              Add link
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}

function LinkList({
  caption,
  hint,
  direction,
  links,
  onRemove,
  busy,
}: {
  readonly caption: string;
  readonly hint: string;
  readonly direction: LinkDirection;
  readonly links: readonly TaskLink[];
  readonly onRemove: ((direction: LinkDirection, link: TaskLink) => Promise<void>) | undefined;
  readonly busy: boolean;
}): JSX.Element {
  return (
    <section className="links__group">
      <h3 className="links__groupTitle">
        {caption}
        <b>{links.length}</b>
      </h3>
      {links.length === 0 ? (
        <p className="links__none">None.</p>
      ) : (
        <>
          <p className="links__hint">{hint}</p>
          <ul className="links__list">
            {links.map((link) => (
              <li key={`${link.uid}-${link.type}`} className="links__item">
                <span className="links__code">{link.wbsCode}</span>
                <span className="links__itemName">{link.name}</span>
                <span className="links__meta">
                  <b>{link.type}</b>
                  {lagLabel(link.lagDays)}
                </span>
                {onRemove === undefined ? null : (
                  <button
                    type="button"
                    className="links__remove"
                    disabled={busy}
                    aria-label={`Remove link to ${link.name}`}
                    onClick={() => void onRemove(direction, link)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
