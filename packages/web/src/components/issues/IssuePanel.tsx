import { useMemo, useState, type JSX } from 'react';
import type { IssueRow } from '../../data/types.js';
import './issues.css';

const SEVERITIES = ['Critical', 'Major', 'Minor'] as const;
type Severity = (typeof SEVERITIES)[number];

export interface IssuePanelProps {
  readonly issues: readonly IssueRow[];
  /** §14.2 P8: "click nhảy tới task". */
  readonly onJumpToTask?: (taskUid: string) => void;
}

export function IssuePanel({ issues, onJumpToTask }: IssuePanelProps): JSX.Element {
  // Mặc định hiện hết: ẩn sẵn một mức nghĩa là giấu vấn đề khỏi người cần thấy nó.
  const [active, setActive] = useState<ReadonlySet<Severity>>(new Set(SEVERITIES));

  const counts = useMemo(() => {
    const map = new Map<Severity, number>(SEVERITIES.map((s) => [s, 0]));
    for (const i of issues) map.set(i.severity, (map.get(i.severity) ?? 0) + 1);
    return map;
  }, [issues]);

  const shown = useMemo(() => issues.filter((i) => active.has(i.severity)), [issues, active]);

  function toggleSeverity(severity: Severity): void {
    const next = new Set(active);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    setActive(next);
  }

  return (
    <aside className="issues" aria-label="Validation issues">
      <div className="issues__head">
        <h2 className="issues__title">Issues</h2>
        <div className="issues__filters" role="group" aria-label="Filter by severity">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              className="issues__filter"
              aria-pressed={active.has(s)}
              onClick={() => toggleSeverity(s)}
            >
              {s}
              <b>{counts.get(s) ?? 0}</b>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="issues__empty">Nothing to show for the selected severities.</p>
      ) : (
        <ul className="issues__list">
          {shown.map((issue, index) => (
            <li key={`${issue.code}-${issue.taskUid ?? 'project'}-${index}`}>
              <button
                type="button"
                className="issues__item"
                disabled={issue.taskUid === null}
                onClick={() => {
                  if (issue.taskUid !== null) onJumpToTask?.(issue.taskUid);
                }}
              >
                <span className="issues__code" data-severity={issue.severity}>
                  {issue.code}
                </span>
                <span className="issues__message">
                  {issue.message}
                  {issue.taskUid === null ? null : (
                    <span className="issues__task">{issue.taskUid}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
