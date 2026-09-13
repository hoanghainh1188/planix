import { useMemo, useState, type JSX } from 'react';
import type { IssueRow, ValidationRun, ValidationRunRow } from '../../data/types.js';
import './issues.css';

const SEVERITIES = ['Critical', 'Major', 'Minor'] as const;
type Severity = (typeof SEVERITIES)[number];

export interface IssuePanelProps {
  readonly issues: readonly IssueRow[];
  /**
   * Lượt validate gần nhất. `null` nghĩa là CHƯA TỪNG chạy — không phải "không có vấn đề".
   *
   * Hai trạng thái này cùng cho ra danh sách rỗng, nên nếu không tách ra thì panel sẽ nói
   * "sạch" về một dự án chưa ai kiểm. Với tool lập kế hoạch, hai câu đó dẫn tới hai quyết
   * định khác nhau.
   */
  readonly lastRun: ValidationRun;
  /** Lịch sử các lượt, mới nhất trước. Rỗng khi dự án chưa từng được kiểm. */
  readonly history: readonly ValidationRunRow[];
  /** Lượt đang xem. `null` = lượt mới nhất, tức trạng thái hiện tại. */
  readonly viewingRunPk: number | null;
  readonly onViewRun: (runPk: number | null) => void;
  /** §14.2 P8: "click nhảy tới task". */
  readonly onJumpToTask?: (taskUid: string) => void;
}

/** Nhãn nguồn, gọn để nằm vừa một dòng chọn. */
const SOURCE_LABEL: Readonly<Record<ValidationRunRow['source'], string>> = {
  import: 'import',
  schedule: 'recalculate',
  progress: 'progress entry',
  edit: 'WBS edit',
};

/**
 * Mốc thời gian ở dạng đọc được.
 *
 * Issue là ảnh chụp tại một thời điểm, không phải trạng thái tức thời: sửa WBS xong thì
 * danh sách này đã cũ cho tới lần validate kế tiếp. Ghi rõ "as of" để PM biết mình đang
 * đọc ảnh chụp lúc nào, thay vì tin nhầm là hiện thời.
 */
function asOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  // `YYYY-MM-DD HH:mm` giờ máy người xem, KHÔNG dùng `toLocaleString`: §10.2 chốt giao
  // diện tiếng Anh, chuỗi cố định. `toLocaleString` đổi dạng theo locale của trình duyệt
  // — trên máy khách Nhật nó ra `2026年9月13日`, lệch hẳn với mọi cột ngày khác trên màn
  // hình vốn đều là ISO. Ảnh chụp màn hình gửi qua lại cũng phải đọc được như nhau.
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    ` ${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

export function IssuePanel({
  issues,
  lastRun,
  history,
  viewingRunPk,
  onViewRun,
  onJumpToTask,
}: IssuePanelProps): JSX.Element {
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
        {lastRun === null ? null : history.length <= 1 ? (
          <p className="issues__asOf">as of {asOf(lastRun.lastAt)}</p>
        ) : (
          /*
           * Có lịch sử thì "as of" thành ô chọn: mỗi dòng là một TRẠNG THÁI issue khác
           * nhau, không phải một lần bấm nút — nên danh sách này ngắn và đọc được.
           */
          <label className="issues__asOf">
            <span className="issues__srOnly">Show issues as of</span>
            <select
              className="issues__runPicker"
              value={viewingRunPk === null ? 'latest' : String(viewingRunPk)}
              onChange={(e) => {
                onViewRun(e.target.value === 'latest' ? null : Number(e.target.value));
              }}
            >
              {history.map((run, index) => (
                <option key={run.id} value={index === 0 ? 'latest' : String(run.id)}>
                  {asOf(run.firstAt)} · {SOURCE_LABEL[run.source]} ·{' '}
                  {run.critical + run.major + run.minor === 0
                    ? 'clean'
                    : `${String(run.critical)}C ${String(run.major)}M ${String(run.minor)}m`}
                  {index === 0 ? ' · now' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
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

      {viewingRunPk !== null ? (
        <p className="issues__past">
          Viewing a past run. This is not the current state.
          <button type="button" className="issues__backToNow" onClick={() => onViewRun(null)}>
            Back to now
          </button>
        </p>
      ) : null}

      {lastRun === null ? (
        /* Chưa kiểm bao giờ. Nói "không có vấn đề" ở đây là nói sai. */
        <p className="issues__empty">
          This project has not been checked yet. Run Recalculate to validate it.
        </p>
      ) : issues.length === 0 ? (
        <p className="issues__empty">
          {viewingRunPk === null ? 'No issues found.' : 'This run had no issues.'}
        </p>
      ) : shown.length === 0 ? (
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
