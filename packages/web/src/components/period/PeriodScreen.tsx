import { useState, type JSX } from 'react';
import type { BaselineRow, BlockingIssue, CloseResult } from '../../data/types.js';
import { suggestedBaselineLabel } from '../../model/baseline-label.js';
import './period.css';

/** §11.1 — ba bản, ba người xem khác nhau. */
const REPORTS: ReadonlyArray<{
  id: 'full' | 'summary' | 'resource';
  label: string;
  who: string;
}> = [
  { id: 'full', label: 'Full', who: 'Internal — every task, 12 columns' },
  { id: 'summary', label: 'Summary', who: 'For the client — Japanese, rolled up' },
  { id: 'resource', label: 'Resource matrix', who: 'Management — people × weeks, in MD' },
];

export interface PeriodScreenProps {
  readonly statusDate: string;
  readonly baselines: readonly BaselineRow[];
  readonly closing: boolean;
  readonly closeResult: CloseResult | null;
  readonly onClose: (statusDate: string, label: string) => Promise<void>;
  readonly downloading: string | null;
  readonly downloadError: readonly BlockingIssue[] | string | null;
  readonly onDownload: (report: 'full' | 'summary' | 'resource', depth: number) => Promise<void>;
}

/**
 * S7 — chốt kỳ và tải báo cáo.
 *
 * Đây là mảnh cuối khép vòng đời hàng tuần: nhập tiến độ (S4) → chốt kỳ → gửi báo cáo.
 * `closePeriod` có ở core từ lâu và `seed:dev --demo` vẫn gọi nó, nhưng trước màn này thì
 * **không đường nào cho PM tự chốt** — phải có shell trên máy chủ.
 */
export function PeriodScreen({
  statusDate,
  baselines,
  closing,
  closeResult,
  onClose,
  downloading,
  downloadError,
  onDownload,
}: PeriodScreenProps): JSX.Element {
  /**
   * Hai ô này GỢI Ý theo dữ liệu, và chỉ thôi gợi ý khi PM đã tự gõ.
   *
   * Khởi tạo bằng `useState(prop)` thì sai: `useState` chỉ đọc giá trị khởi tạo đúng một
   * lần, còn danh sách baseline thì tới SAU (nó là một truy vấn riêng). Hệ quả thật đã
   * gặp: đổi sang dự án chưa có baseline nào mà ô tên vẫn đề "Plan v1.1", tức tên của dự
   * án trước — và bấm Close period là chốt một mốc mang tên sai.
   *
   * `null` = "PM chưa đụng vào", nên cứ bám theo dữ liệu. Gõ một chữ là chốt lại ngay.
   */
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);

  const date = dateDraft ?? statusDate;
  // §7.13: baseline đầu tiên là mốc cam kết. Đánh số tiếp theo số bản đã có, nhưng vẫn
  // cho sửa — cách đặt tên là việc của PM, không phải của tool.
  const label = labelDraft ?? suggestedBaselineLabel(baselines.length);

  return (
    <section className="period" aria-label="Reports and close period">
      <div className="period__intro">
        <h1 className="period__title">Reports &amp; close period</h1>
        <p className="period__lead">
          Closing a period sets the status date and takes a baseline — the snapshot every later
          report is measured against.
        </p>
      </div>

      <section className="period__block" aria-labelledby="close-heading">
        <h2 className="period__heading" id="close-heading">
          Close the period
        </h2>

        <div className="period__form">
          <label className="period__field">
            <span className="period__label">Status date</span>
            <input
              type="date"
              className="period__input"
              value={date}
              disabled={closing}
              onChange={(e) => setDateDraft(e.target.value)}
            />
          </label>
          <label className="period__field period__field--wide">
            <span className="period__label">Baseline name</span>
            <input
              type="text"
              className="period__input"
              value={label}
              disabled={closing}
              onChange={(e) => setLabelDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="period__button period__button--go"
            disabled={closing || date === '' || label.trim() === ''}
            onClick={() => void onClose(date, label.trim())}
          >
            {closing ? 'Closing…' : 'Close period'}
          </button>
        </div>

        {closeResult === null ? null : closeResult.ok ? (
          <p className="period__panel period__panel--good" role="status">
            Closed. Baseline taken over {closeResult.taskCount} tasks.
          </p>
        ) : (
          <div className="period__panel period__panel--bad" role="alert">
            <p className="period__panelHead">{closeResult.message}</p>
            {/*
              §7.13 dừng hẳn khi có Critical, khác với mọi đường ghi khác (§12.4 cho ghi
              rồi báo). Baseline là mốc cam kết — dựng nó trên dữ liệu hỏng là làm hỏng
              chính thước đo. Nên ở đây phải liệt kê ra cho PM đi sửa.
            */}
            <IssueList issues={closeResult.issues.filter((i) => i.severity === 'Critical')} />
          </div>
        )}
      </section>

      <section className="period__block" aria-labelledby="baselines-heading">
        <h2 className="period__heading" id="baselines-heading">
          Baselines
        </h2>
        {baselines.length === 0 ? (
          <p className="period__empty">
            No baseline yet. Until there is one, EVM has nothing to measure against.
          </p>
        ) : (
          <ul className="period__baselines">
            {baselines.map((b, index) => (
              <li key={b.id} className="period__baseline">
                <span className="period__baselineLabel">{b.label}</span>
                <span className="period__baselineDate">as of {b.statusDate}</span>
                {/* §7.13: bản đầu tiên là mốc cam kết, mọi so sánh scope creep dựa vào nó. */}
                {index === baselines.length - 1 ? (
                  <span className="period__tag">committed plan</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="period__block" aria-labelledby="reports-heading">
        <h2 className="period__heading" id="reports-heading">
          Download a report
        </h2>

        <ul className="period__reports">
          {REPORTS.map((r) => (
            <li key={r.id} className="period__report">
              <span className="period__reportText">
                <b>{r.label}</b>
                <span className="period__reportWho">{r.who}</span>
              </span>
              {r.id === 'summary' ? (
                <label className="period__depth">
                  <span className="period__label">Levels</span>
                  <select
                    className="period__input period__input--narrow"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  >
                    {/* §11.3: đúng ba cột phân cấp, nên tối đa 3 — không dồn cấp sâu hơn. */}
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="period__button"
                disabled={downloading !== null}
                onClick={() => void onDownload(r.id, depth)}
              >
                {downloading === r.id ? 'Preparing…' : 'Download'}
              </button>
            </li>
          ))}
        </ul>

        {downloadError === null ? null : typeof downloadError === 'string' ? (
          <p className="period__panel period__panel--bad" role="alert">
            {downloadError}
          </p>
        ) : (
          <div className="period__panel period__panel--bad" role="alert">
            <p className="period__panelHead">
              Nothing was exported — the project has blocking issues.
            </p>
            <IssueList issues={downloadError} />
          </div>
        )}
      </section>
    </section>
  );
}

function IssueList({ issues }: { readonly issues: readonly BlockingIssue[] }): JSX.Element {
  return (
    <ul className="period__issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${String(index)}`} className="period__issue">
          <span className="period__issueCode">{issue.code}</span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
