import { useState, type JSX } from 'react';
import type { TaskDetail, TaskLabels } from '../../data/types.js';
import './detail.css';

/**
 * S2 — Task detail.
 *
 * §10 không đặc tả màn này (chỉ có một dòng trong bảng §10.3), nên phạm vi do PM chốt
 * ngày 2026-09-14: xem `docs/decisions/2026-09-14-s2-pham-vi.md`.
 *
 *   - **Sửa được**: `description`, `category`, `phase`, `module`, `external_ref`.
 *   - **Chỉ đọc**: ngày, float, người, tiến độ, dependency, lý do chậm.
 *
 * Nhóm sửa được là nhóm DUY NHẤT trước nay không có đường ghi nào trong web — và chính
 * là thứ rule `N03` đang báo lỗi. Trước màn này, PM đọc được "leaf thiếu phase và module"
 * mà không có cách nào vá ngoài nạp lại cả file import.
 *
 * Ngày **không** sửa được ở đây, và đó là N3 (§2) chứ không phải thiếu sót: engine sở hữu
 * ngày, người dùng đổi ngày bằng cách đổi dữ liệu đầu vào rồi xếp lại.
 */

/** Nhãn nhóm sửa được. Thứ tự này là thứ tự PM đọc, không phải thứ tự cột trong DB. */
const LABEL_FIELDS: ReadonlyArray<{
  readonly key: keyof TaskLabels;
  readonly label: string;
  readonly hint?: string;
  readonly long?: boolean;
}> = [
  { key: 'phase', label: 'Phase', hint: 'Rule N03 asks every leaf for this' },
  { key: 'module', label: 'Module', hint: 'Rule N03 asks every leaf for this' },
  { key: 'category', label: 'Category' },
  { key: 'externalRef', label: 'External ref', hint: 'e.g. a Jira key' },
  { key: 'description', label: 'Description', long: true },
];

export interface TaskDetailPanelProps {
  readonly detail: TaskDetail | null;
  readonly loading: boolean;
  /** Vắng mặt thì panel chỉ để xem — lead xem được, không sửa được (§10.6). */
  readonly onSave?: (labels: TaskLabels) => Promise<void>;
  readonly busy?: boolean;
}

export function TaskDetailPanel({
  detail,
  loading,
  onSave,
  busy = false,
}: TaskDetailPanelProps): JSX.Element {
  /**
   * `null` = chưa ai gõ gì, cứ bám theo dữ liệu từ server.
   *
   * Không khởi tạo bằng `useState(detail)`: `useState` chỉ đọc giá trị khởi tạo đúng MỘT
   * lần, nên chọn sang task khác thì ô vẫn giữ nội dung của task trước — và bấm Save là
   * ghi dữ liệu của task cũ đè lên task mới. Đúng lỗi này đã xảy ra hai lần ở S7 với ngày
   * và nhãn baseline.
   *
   * `key` ở chỗ gọi cũng buộc panel dựng lại khi đổi task; hai lớp phòng vì hậu quả ở đây
   * là ghi nhầm dữ liệu, không phải hiển thị lệch.
   */
  const [draft, setDraft] = useState<TaskLabels | null>(null);

  if (loading) return <p className="detail__empty">Loading…</p>;
  if (detail === null) return <p className="detail__empty">Select a task to see its detail.</p>;

  const { task, dependencies, explanation } = detail;
  const saved: TaskLabels = {
    description: task.description ?? null,
    category: task.category ?? null,
    phase: task.phase ?? null,
    module: task.module ?? null,
    externalRef: task.externalRef ?? null,
  };
  const current = draft ?? saved;
  const dirty =
    draft !== null && LABEL_FIELDS.some((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));

  const set = (key: keyof TaskLabels, value: string): void => {
    setDraft({ ...current, [key]: value === '' ? null : value });
  };

  return (
    <section className="detail" aria-label="Task detail">
      <header className="detail__head">
        <span className="detail__code">{task.wbsCode}</span>
        <h2 className="detail__name">{task.name}</h2>
        <span className={`detail__kind detail__kind--${task.kind}`}>{task.kind}</span>
      </header>

      <dl className="detail__facts">
        <Fact label="Status" value={task.status} />
        <Fact label="Progress" value={`${String(task.percent)}%`} />
        <Fact label="Effort" value={task.effortMd === null ? '—' : `${String(task.effortMd)} MD`} />
        <Fact label="Role" value={task.role ?? '—'} />
        <Fact label="PIC" value={task.assigneeName ?? '—'} />
        <Fact label="Allocation" value={task.allocation === null ? '—' : String(task.allocation)} />
        <Fact label="Plan start" value={task.startDate ?? '—'} />
        <Fact label="Plan end" value={task.endDate ?? '—'} />
        <Fact
          label="Float"
          value={task.totalFloat === null ? '—' : `${String(task.totalFloat)} d`}
        />
        <Fact label="Actual start" value={task.actualStart ?? '—'} />
        <Fact label="Actual end" value={task.actualEnd ?? '—'} />
        <Fact label="Priority" value={String(task.priority)} />
      </dl>

      {task.isCritical || task.isResourceCritical || task.isPinned ? (
        <p className="detail__tags">
          {task.isCritical ? <span className="detail__tag">critical path</span> : null}
          {task.isResourceCritical ? <span className="detail__tag">resource-critical</span> : null}
          {/* Ghim chỉ sửa được qua import hoặc MCP — hiện ra để PM biết nó đang có. */}
          {task.isPinned ? (
            <span className="detail__tag detail__tag--pin">
              pinned to {task.assigneeName ?? task.assigneeId ?? '?'}
            </span>
          ) : null}
        </p>
      ) : null}

      {/*
        §7.6 — vì sao task nằm ở chỗ nó đang nằm. Chuỗi dừng ở mắt không phải dependency,
        và `ref` khi đó là một người hoặc một dự án, không phải task.
      */}
      {explanation.chain.length > 1 ? (
        <section className="detail__block" aria-labelledby="why-heading">
          <h3 className="detail__heading" id="why-heading">
            Why it starts here
          </h3>
          <ol className="detail__chain">
            {explanation.chain.map((link) => (
              <li key={link.taskUid} className="detail__chainItem">
                <span className="detail__chainCode">{link.wbsCode}</span>
                <span className="detail__chainName">{link.name}</span>
                {link.reason === null ? null : (
                  <span className="detail__chainReason">
                    {link.reason}
                    {link.reason !== 'dependency' && link.ref !== null ? ` · ${link.ref}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {explanation.truncated ? (
            <p className="detail__note">Chain cut at the depth limit; there is more upstream.</p>
          ) : null}
        </section>
      ) : null}

      <section className="detail__block" aria-labelledby="links-heading">
        <h3 className="detail__heading" id="links-heading">
          Dependencies
        </h3>
        {dependencies.predecessors.length === 0 && dependencies.successors.length === 0 ? (
          <p className="detail__note">No links. Use the Links tab to add one.</p>
        ) : (
          <ul className="detail__links">
            {dependencies.predecessors.map((l) => (
              <li key={`p-${l.uid}-${l.type}`}>
                <b>after</b> {l.wbsCode} {l.name} <i>{l.type}</i>
              </li>
            ))}
            {dependencies.successors.map((l) => (
              <li key={`s-${l.uid}-${l.type}`}>
                <b>before</b> {l.wbsCode} {l.name} <i>{l.type}</i>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail__block" aria-labelledby="labels-heading">
        <h3 className="detail__heading" id="labels-heading">
          Classification
        </h3>
        {onSave === undefined ? (
          <dl className="detail__facts">
            {LABEL_FIELDS.map((f) => (
              <Fact key={f.key} label={f.label} value={saved[f.key] ?? '—'} />
            ))}
          </dl>
        ) : (
          <>
            {LABEL_FIELDS.map((f) => (
              <label key={f.key} className="detail__field">
                <span className="detail__label">
                  {f.label}
                  {f.hint === undefined ? null : <i className="detail__hint">{f.hint}</i>}
                </span>
                {f.long ? (
                  <textarea
                    className="detail__input detail__input--area"
                    value={current[f.key] ?? ''}
                    disabled={busy}
                    rows={3}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    className="detail__input"
                    value={current[f.key] ?? ''}
                    disabled={busy}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}

            <div className="detail__actions">
              <button
                type="button"
                className="detail__button detail__button--go"
                disabled={!dirty || busy}
                onClick={() => {
                  void onSave(current).then(() => {
                    // Bỏ bản nháp sau khi lưu để ô quay về bám dữ liệu server. Giữ lại
                    // thì lần tải sau có sửa giá trị cũng không hiện ra.
                    setDraft(null);
                  });
                }}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="detail__button"
                disabled={!dirty || busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <>
      <dt className="detail__factLabel">{label}</dt>
      <dd className="detail__factValue">{value}</dd>
    </>
  );
}
