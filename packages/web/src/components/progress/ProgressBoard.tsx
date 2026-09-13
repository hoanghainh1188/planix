import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { validateProgressEntry } from '@planix/core/domain/progress-suggest.js';
import {
  acceptAllSuggestions,
  applyStatusKey,
  attentionCount,
  buildDraft,
  changedRows,
  editEntry,
  fillDown,
  groupMicroByParent,
  markSubtreeDone,
  setStatus,
  visibleRows,
  type BoardRow,
  type Draft,
  type ProgressStatus,
  type SaveRow,
} from '../../model/progress-model.js';
import './progress.css';

interface Props {
  readonly rows: readonly BoardRow[];
  readonly statusDate: string;
  readonly saving: boolean;
  readonly onSave: (rows: readonly SaveRow[]) => void;
}

const NORMAL_STATUSES: readonly ProgressStatus[] = [
  'not_started',
  'in_progress',
  'done',
  'blocked',
  'cancelled',
];
/** §7.9 — micro task chỉ có ba giá trị này. */
const MICRO_STATUSES: readonly ProgressStatus[] = ['not_started', 'done', 'cancelled'];

/**
 * S4 — màn nhập tiến độ (§10.5).
 *
 * §10.5 gọi đây là "màn quyết định tool sống hay chết", và R1/R4 nói rõ vì sao: nếu nhập
 * ở đây chậm hơn gõ chat thì lead sẽ không dùng, và cả tool thành vô nghĩa. Nên mặc định
 * là *ít dòng nhất có thể* và *bàn phím trước chuột*.
 */
export function ProgressBoard({ rows, statusDate, saving, onSave }: Props): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => buildDraft(rows));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  /**
   * Bản sao đồng bộ của `cursor`.
   *
   * Lead gõ rất nhanh: `D ↓ D ↓ D`. Mỗi phím là một sự kiện riêng, nhưng React gộp việc
   * cập nhật state, nên handler của phím sau vẫn đọc `cursor` của lần render trước và
   * đánh dấu NHẦM DÒNG. Ref cập nhật ngay trong handler nên luôn là giá trị mới nhất.
   */
  const cursorRef = useRef(0);
  const [showAll, setShowAll] = useState(false);
  const [expandOnTrack, setExpandOnTrack] = useState(false);
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => visibleRows(rows, draft, statusDate, { showAll, expandOnTrack, query }),
    [rows, draft, statusDate, showAll, expandOnTrack, query],
  );
  const counts = useMemo(() => attentionCount(rows, draft, statusDate), [rows, draft, statusDate]);
  const microGroups = useMemo(() => groupMicroByParent(rows, draft), [rows, draft]);
  const pending = useMemo(() => changedRows(draft, rows), [draft, rows]);

  const onTrackHidden = useMemo(
    () => (showAll || expandOnTrack ? 0 : rows.filter((r) => r.onTrack).length),
    [rows, showAll, expandOnTrack],
  );

  /** Lỗi tính LẠI mỗi lần gõ — §10.5: "chặn tại ô, không đợi lúc lưu". */
  const errorsByUid = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const { row, entry } of visible) {
      const errs = validateProgressEntry({
        status: entry.status,
        percent: entry.percent,
        actualStart: entry.actualStart,
        actualEnd: entry.actualEnd,
        blockedNote: entry.blockedNote,
        isMicro: row.isMicro,
        statusDate,
      });
      if (errs.length > 0) {
        map.set(row.uid, new Map(errs.map((e) => [e.field, e.message])));
      }
    }
    return map;
  }, [visible, statusDate]);

  const blocked = errorsByUid.size > 0;

  const save = useCallback(() => {
    if (blocked || pending.length === 0 || saving) return;
    onSave(pending);
  }, [blocked, pending, saving, onSave]);

  const moveCursor = useCallback((next: number) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const at = cursorRef.current;
      const row = visible[at]?.row;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (row !== undefined) setDraft((d) => fillDown(d, row.uid, [...selected]));
        return;
      }
      // Không nuốt phím khi người dùng đang gõ vào ô nhập.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveCursor(Math.min(at + 1, visible.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveCursor(Math.max(at - 1, 0));
        return;
      }
      if (row === undefined) return;

      if (event.key === ' ') {
        event.preventDefault();
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(row.uid)) next.delete(row.uid);
          else next.add(row.uid);
          return next;
        });
        return;
      }

      const key = event.key.toUpperCase();
      if (key === 'D' || key === 'P' || key === 'B') {
        event.preventDefault();
        setDraft((d) => applyStatusKey(d, row.uid, key, statusDate, rows));
      }
    },
    [visible, selected, rows, statusDate, save, moveCursor],
  );

  function selectRange(index: number, uid: string, shift: boolean): void {
    const from = Math.min(cursorRef.current, index);
    const to = Math.max(cursorRef.current, index);
    moveCursor(index);
    if (!shift) {
      setSelected(new Set([uid]));
      return;
    }
    const next = new Set<string>();
    for (let i = from; i <= to; i++) {
      const r = visible[i]?.row.uid;
      if (r !== undefined) next.add(r);
    }
    setSelected(next);
  }

  function setStatusForSelection(status: ProgressStatus): void {
    setDraft((d) => {
      let next = d;
      // Cùng một hàm với phím tắt: bấm nút hay gõ phím phải ra đúng một kết quả.
      for (const uid of selected) next = setStatus(next, uid, status, statusDate, rows);
      return next;
    });
  }

  return (
    <section className="pb" aria-label="Progress entry">
      <header className="pb__bar">
        <div className="pb__counts">
          <strong className="pb__reviewed">
            Reviewed {counts.reviewed} / {counts.total}
          </strong>
          <span className="pb__hint">tasks needing attention</span>
          <span className="pb__asof">as of {statusDate}</span>
        </div>

        <input
          className="pb__search"
          type="search"
          placeholder="Search tasks or WBS code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="pb__toggles">
          <label className="pb__toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all
          </label>
          <label className="pb__toggle">
            <input
              type="checkbox"
              checked={expandOnTrack}
              onChange={(e) => setExpandOnTrack(e.target.checked)}
            />
            Expand on track
          </label>
        </div>

        <div className="pb__actions">
          <button
            type="button"
            className="pb__action"
            onClick={() => setDraft((d) => acceptAllSuggestions(d))}
          >
            Accept all suggestions
          </button>
          <button
            type="button"
            className="pb__action pb__action--primary"
            onClick={save}
            disabled={blocked || pending.length === 0 || saving}
            title={blocked ? 'Fix the highlighted cells first' : undefined}
          >
            {saving ? 'Saving…' : `Save ${pending.length} row${pending.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </header>

      {selected.size > 0 ? (
        <div className="pb__bulk" role="toolbar" aria-label="Bulk actions">
          <span className="pb__bulkCount">{selected.size} selected</span>
          {(['not_started', 'in_progress', 'done', 'blocked'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="pb__chip"
              onClick={() => setStatusForSelection(s)}
            >
              {label(s)}
            </button>
          ))}
          <button
            type="button"
            className="pb__chip"
            onClick={() => {
              const row = visible[cursorRef.current]?.row;
              if (row !== undefined) setDraft((d) => fillDown(d, row.uid, [...selected]));
            }}
          >
            Fill down (Ctrl+D)
          </button>
          <button type="button" className="pb__chip" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {microGroups.length > 0 ? (
        <div className="pb__micro" aria-label="Micro task clusters">
          {microGroups.map((g) => (
            <button
              key={g.parentUid}
              type="button"
              className="pb__microGroup"
              onClick={() => setDraft((d) => markSubtreeDone(d, rows, g.parentUid, statusDate))}
              title={`Mark all of ${g.parentName} done as of ${statusDate}`}
            >
              <span className="pb__microName">{g.parentName}</span>
              <span className="pb__microCount">
                {g.done}/{g.total} done
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/*
        `tabIndex` để lưới nhận được phím tắt của §10.5 (D / P / B / Space / Ctrl+D).
        Không có nó thì toàn bộ phần "bàn phím" của spec không chạy, và §10.5 nói rõ S4
        phải nhanh hơn gõ chat — tức là phải dùng được mà không cần chuột.
      */}
      <div className="pb__grid" ref={gridRef} tabIndex={0} onKeyDown={handleKey} role="grid">
        <div className="pb__row pb__row--head" role="row">
          <span>No.</span>
          <span>Task</span>
          <span>PIC</span>
          <span>MD</span>
          <span>Plan</span>
          <span>Status</span>
          <span>%</span>
          <span>Actual start</span>
          <span>Actual end</span>
          <span>Note</span>
        </div>

        {visible.length === 0 ? (
          <p className="pb__empty">
            Nothing needs attention. {onTrackHidden > 0 ? `${onTrackHidden} tasks on track.` : ''}
          </p>
        ) : (
          visible.map(({ row, entry }, index) => {
            const errs = errorsByUid.get(row.uid);
            const statuses = row.isMicro ? MICRO_STATUSES : NORMAL_STATUSES;
            return (
              <div
                key={row.uid}
                role="row"
                className={[
                  'pb__row',
                  entry.isSuggestion ? 'pb__row--suggested' : '',
                  selected.has(row.uid) ? 'pb__row--selected' : '',
                  index === cursor ? 'pb__row--cursor' : '',
                  errs !== undefined ? 'pb__row--invalid' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(e) => selectRange(index, row.uid, e.shiftKey)}
              >
                <span className="pb__code">{row.wbsCode}</span>
                <span className="pb__name" title={row.name}>
                  {row.name}
                  {row.isMicro ? <span className="pb__tag">micro</span> : null}
                </span>
                <span className="pb__pic">{row.pic ?? '—'}</span>
                <span className="pb__md">{row.effortMd ?? ''}</span>
                <span className="pb__plan">
                  {row.planStart ?? '—'} → {row.planEnd ?? '—'}
                </span>

                <span className="pb__cell">
                  <select
                    className="pb__input"
                    value={entry.status}
                    aria-label={`Status for ${row.name}`}
                    onChange={(e) =>
                      setDraft((d) =>
                        editEntry(d, row.uid, { status: e.target.value as ProgressStatus }),
                      )
                    }
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </span>

                {/* §7.9: micro task ẩn HOÀN TOÀN ô %, không phải chỉ khoá lại. */}
                <span className="pb__cell">
                  {row.isMicro ? (
                    <span className="pb__dash">—</span>
                  ) : (
                    <input
                      className={cellClass(errs, 'percent')}
                      type="number"
                      min={0}
                      max={100}
                      value={entry.percent}
                      aria-label={`Percent for ${row.name}`}
                      onChange={(e) =>
                        setDraft((d) => editEntry(d, row.uid, { percent: Number(e.target.value) }))
                      }
                    />
                  )}
                </span>

                <span className="pb__cell">
                  <input
                    className={cellClass(errs, 'actualStart')}
                    type="date"
                    value={entry.actualStart ?? ''}
                    aria-label={`Actual start for ${row.name}`}
                    onChange={(e) =>
                      setDraft((d) =>
                        editEntry(d, row.uid, { actualStart: e.target.value || null }),
                      )
                    }
                  />
                </span>

                <span className="pb__cell">
                  <input
                    className={cellClass(errs, 'actualEnd')}
                    type="date"
                    value={entry.actualEnd ?? ''}
                    aria-label={`Actual end for ${row.name}`}
                    onChange={(e) =>
                      setDraft((d) => editEntry(d, row.uid, { actualEnd: e.target.value || null }))
                    }
                  />
                </span>

                <span className="pb__cell">
                  <input
                    className={cellClass(errs, 'blockedNote')}
                    type="text"
                    placeholder={entry.status === 'blocked' ? 'Why is it blocked?' : ''}
                    value={entry.blockedNote ?? ''}
                    aria-label={`Note for ${row.name}`}
                    onChange={(e) =>
                      setDraft((d) =>
                        editEntry(d, row.uid, { blockedNote: e.target.value || null }),
                      )
                    }
                  />
                </span>

                {errs !== undefined ? (
                  <span className="pb__errors" role="alert">
                    {[...errs.values()].join(' ')}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {onTrackHidden > 0 ? (
        <button type="button" className="pb__ontrack" onClick={() => setExpandOnTrack(true)}>
          {onTrackHidden} tasks on track — expand to review
        </button>
      ) : null}
    </section>
  );
}

function cellClass(errs: Map<string, string> | undefined, field: string): string {
  return errs?.has(field) === true ? 'pb__input pb__input--invalid' : 'pb__input';
}

function label(status: ProgressStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'cancelled':
      return 'Cancelled';
  }
}
