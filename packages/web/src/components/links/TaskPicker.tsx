import { useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { WbsRow } from '../../data/types.js';

/** Nhiều hơn ngần này thì danh sách dài hơn khung và không còn quét bằng mắt được nữa. */
const MAX_MATCHES = 8;

export interface TaskPickerProps {
  readonly rows: readonly WbsRow[];
  /** Không bao giờ cho chọn chính nó — §6 cấm task phụ thuộc chính mình. */
  readonly excludeUid: string | null;
  readonly value: WbsRow | null;
  readonly onChange: (row: WbsRow | null) => void;
  readonly disabled?: boolean;
}

/**
 * Chọn task bằng cách gõ, không phải bằng một `<select>` 6.000 dòng.
 *
 * Khớp trên cả mã WBS và tên: PM nhớ "1.2" hoặc nhớ "thiết kế API", tuỳ lúc.
 */
export function TaskPicker({
  rows,
  excludeUid,
  value,
  onChange,
  disabled = false,
}: TaskPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    const out: WbsRow[] = [];
    for (const r of rows) {
      if (r.uid === excludeUid) continue;
      if (!r.name.toLowerCase().includes(q) && !r.wbsCode.startsWith(q)) continue;
      out.push(r);
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }, [rows, query, excludeUid]);

  function pick(row: WbsRow): void {
    onChange(row);
    setQuery('');
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      const row = matches[active];
      if (row !== undefined) {
        event.preventDefault();
        pick(row);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  if (value !== null) {
    return (
      <p className="links__chip">
        <span className="links__code">{value.wbsCode}</span>
        <span className="links__chipName">{value.name}</span>
        <button
          type="button"
          className="links__chipClear"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={`Clear ${value.name}`}
        >
          ×
        </button>
      </p>
    );
  }

  return (
    <div className="links__picker">
      <input
        ref={inputRef}
        type="text"
        className="links__input"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="links-picker-list"
        aria-label="Find a task"
        placeholder="Find a task by number or name…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 ? (
        <ul className="links__matches" id="links-picker-list" role="listbox">
          {matches.map((row, index) => (
            <li key={row.uid} role="option" aria-selected={index === active}>
              <button
                type="button"
                className="links__match"
                data-active={index === active ? '' : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row)}
              >
                <span className="links__code">{row.wbsCode}</span>
                <span className="links__matchName">{row.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
