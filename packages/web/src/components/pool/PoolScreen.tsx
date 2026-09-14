import { useState, type JSX } from 'react';
import type { PoolLoad } from '../../data/types.js';
import './pool.css';

/**
 * S9 — Resource pool xuyên dự án (§10.3, §7.12).
 *
 * §10.3 ghi "Admin, PM đọc", và §10.6 cho `view_resource_pool` là `{pm: true,
 * lead: false}`. Chỉ đọc: sửa người và lịch nghỉ nằm ở S5.
 *
 * ## Câu hỏi màn này trả lời, mà không màn nào khác trả lời được
 *
 * §7.12: `resource` là tài nguyên toàn cục và các dự án tranh nhau theo `priority`.
 * Nhìn từ TRONG một dự án, một người đặt 100% trông hoàn toàn bình thường — dù bên dự án
 * kia họ cũng đang bị đặt 100%. Chỉ pool mới thấy 200%.
 *
 * `J14` nói được dự án nào chiếm chỗ, nhưng không nói được hình dạng: ai căng, căng vào
 * tuần nào. Đó là thứ bảng này hiện.
 */

/** Ngưỡng tô màu. Trên 1 là đặt quá năng lực; 0.85 là sát trần, đáng nhìn trước. */
const TIGHT = 0.85;

function tone(utilisation: number | null): string {
  if (utilisation === null) return 'pool__cell--off';
  if (utilisation > 1) return 'pool__cell--over';
  if (utilisation >= TIGHT) return 'pool__cell--tight';
  if (utilisation === 0) return 'pool__cell--free';
  return '';
}

export interface PoolScreenProps {
  readonly data: PoolLoad | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly from: string;
  readonly to: string;
  readonly by: 'day' | 'week' | 'month';
  readonly onRange: (from: string, to: string, by: 'day' | 'week' | 'month') => void;
}

export function PoolScreen(props: PoolScreenProps): JSX.Element {
  const [onlyProblems, setOnlyProblems] = useState(false);

  const rows = props.data?.rows ?? [];
  const shown = onlyProblems ? rows.filter((r) => r.overbooked) : rows;
  const overCount = rows.filter((r) => r.overbooked).length;

  return (
    <section className="pool" aria-label="Resource pool">
      <div className="pool__intro">
        <h1 className="pool__title">Resource pool</h1>
        <p className="pool__lead">
          Everyone, across every active project. A person booked 100% here and 100% on another
          project shows as 200% — which is the thing a single project&rsquo;s view can never show
          you (§7.12).
        </p>
      </div>

      <div className="pool__controls">
        <label className="pool__field">
          <span className="pool__label">From</span>
          <input
            type="date"
            className="pool__input"
            value={props.from}
            onChange={(e) => props.onRange(e.target.value, props.to, props.by)}
          />
        </label>
        <label className="pool__field">
          <span className="pool__label">To</span>
          <input
            type="date"
            className="pool__input"
            value={props.to}
            onChange={(e) => props.onRange(props.from, e.target.value, props.by)}
          />
        </label>
        <label className="pool__field">
          <span className="pool__label">By</span>
          <select
            className="pool__input"
            value={props.by}
            onChange={(e) =>
              props.onRange(props.from, props.to, e.target.value as 'day' | 'week' | 'month')
            }
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label className="pool__check">
          <input
            type="checkbox"
            checked={onlyProblems}
            disabled={overCount === 0}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          Only overbooked
          <b>{overCount}</b>
        </label>
      </div>

      {props.error === null ? null : (
        <p className="pool__error" role="alert">
          {props.error}
        </p>
      )}

      {props.data !== null && props.data.projects.length > 0 ? (
        <p className="pool__legend">
          {/* §7.12 xếp lịch theo thứ tự ưu tiên, nên hiện luôn để PM hiểu ai nhường ai. */}
          Competing in priority order:{' '}
          {props.data.projects.map((p) => (
            <span key={p.id} className="pool__chip">
              {p.code} <i>#{p.priority}</i>
            </span>
          ))}
        </p>
      ) : null}

      {props.loading ? (
        <p className="pool__empty">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="pool__empty">
          {rows.length === 0
            ? 'No people in the pool yet.'
            : 'Nobody is overbooked in this window.'}
        </p>
      ) : (
        <div className="pool__tableWrap">
          <table className="pool__table">
            <thead>
              <tr>
                <th scope="col" className="pool__sticky">
                  Person
                </th>
                {(props.data?.buckets ?? []).map((b) => (
                  <th scope="col" key={b} className="pool__period">
                    {b.replace('W', '')}
                  </th>
                ))}
                <th scope="col">Booked by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.resourceId}>
                  <th scope="row" className="pool__sticky pool__person">
                    <span className="pool__personName">{r.resourceName}</span>
                    <span className="pool__personId">{r.resourceId}</span>
                  </th>
                  {r.cells.map((c) => (
                    <td
                      key={c.bucket}
                      className={`pool__cell ${tone(c.utilisation)}`}
                      // Con số thô vẫn phải với tới được: ô chỉ đủ chỗ cho phần trăm.
                      title={`${String(c.allocatedMd)} / ${String(c.capacityMd)} MD`}
                    >
                      {c.utilisation === null ? '—' : `${String(Math.round(c.utilisation * 100))}%`}
                    </td>
                  ))}
                  <td className="pool__by">
                    {r.byProject.length === 0
                      ? '—'
                      : r.byProject.map((p) => (
                          <span key={p.projectId} className="pool__chip">
                            {p.projectCode} <i>{p.md} MD</i>
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
