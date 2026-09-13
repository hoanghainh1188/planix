import { useMemo, useState, type JSX } from 'react';
import {
  buildTimeline,
  dayOffset,
  distinct,
  ganttBars,
  type GanttRow,
} from '../../model/gantt-model.js';
import { compareWbs } from '../../model/tree-model.js';
import './gantt.css';

interface Props {
  readonly rows: readonly GanttRow[];
  readonly statusDate: string;
}

const DAY_WIDTH = 4;
const ROW_HEIGHT = 22;
const LABEL_WIDTH = 280;
const HEADER_HEIGHT = 28;

/**
 * S3 — Gantt, CHỈ XEM (§10.3, N3).
 *
 * Không có handler kéo thả nào ở đây, và đó là cố ý: N3 cấm đổi ngày trên UI. Muốn ngày
 * đổi thì sửa đầu vào rồi chạy lại engine — đó là toàn bộ luận điểm của tool này.
 *
 * Vẽ bằng SVG thay vì div: 6.000 thanh dưới dạng div sẽ làm trình duyệt bò, còn SVG thì
 * chỉ là một cây hình học phẳng.
 */
export function GanttChart({ rows, statusDate }: Props): JSX.Element {
  const [team, setTeam] = useState('');
  const [phase, setPhase] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);

  const teams = useMemo(() => distinct(rows, (r) => r.teamId), [rows]);
  const phases = useMemo(() => distinct(rows, (r) => r.phase), [rows]);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => {
          if (team !== '' && r.teamId !== team) return false;
          if (phase !== '' && r.phase !== phase) return false;
          if (criticalOnly && !r.isCritical) return false;
          return true;
        })
        // SQL `ORDER BY wbs_code` sắp theo chuỗi, nên 1.1.1.10 chen lên trước 1.1.1.2.
        // Sắp lại bằng natural sort, đúng thứ tự mà S1 đang hiện.
        .sort((a, b) => compareWbs(a.wbsCode, b.wbsCode)),
    [rows, team, phase, criticalOnly],
  );

  // Trục dựng trên tập ĐÃ lọc: lọc còn một phase mà trục vẫn trải cả năm thì thanh bé xíu.
  const timeline = useMemo(() => buildTimeline(filtered), [filtered]);
  const bars = useMemo(() => ganttBars(filtered, timeline, DAY_WIDTH), [filtered, timeline]);

  const chartWidth = Math.max(1, timeline.totalDays * DAY_WIDTH);
  const height = bars.length * ROW_HEIGHT;
  const todayOffset =
    timeline.totalDays > 0 && statusDate >= timeline.start && statusDate <= timeline.end
      ? dayOffset(timeline.start, statusDate) * DAY_WIDTH
      : null;

  return (
    <section className="gantt" aria-label="Gantt chart">
      <header className="gantt__bar">
        <span className="gantt__title">Gantt</span>
        <span className="gantt__readonly" title="Dates come from the engine (N3)">
          view only
        </span>

        <label className="gantt__filter">
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="gantt__filter">
          Phase
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="">All</option>
            {phases.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="gantt__filter gantt__filter--check">
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => setCriticalOnly(e.target.checked)}
          />
          Critical path only
        </label>

        <span className="gantt__count">{bars.length} bars</span>
      </header>

      {bars.length === 0 ? (
        <p className="gantt__empty">No scheduled tasks match these filters.</p>
      ) : (
        <div className="gantt__scroll">
          <svg
            className="gantt__svg"
            width={LABEL_WIDTH + chartWidth}
            height={HEADER_HEIGHT + height}
            role="img"
            aria-label={`${bars.length} scheduled tasks from ${timeline.start} to ${timeline.end}`}
          >
            {/* Mốc tháng */}
            <g className="gantt__ticks">
              {timeline.ticks.map((t) => (
                <g
                  key={t.label}
                  transform={`translate(${LABEL_WIDTH + t.dayOffset * DAY_WIDTH} 0)`}
                >
                  <line y1={0} y2={HEADER_HEIGHT + height} className="gantt__tickLine" />
                  <text x={4} y={18} className="gantt__tickLabel">
                    {t.label}
                  </text>
                </g>
              ))}
            </g>

            {/* Mốc chuẩn §7.13 — "hôm nay" của dự án, không phải hôm nay của máy */}
            {todayOffset !== null ? (
              <line
                x1={LABEL_WIDTH + todayOffset}
                x2={LABEL_WIDTH + todayOffset}
                y1={0}
                y2={HEADER_HEIGHT + height}
                className="gantt__today"
              >
                <title>Status date {statusDate}</title>
              </line>
            ) : null}

            <g transform={`translate(0 ${HEADER_HEIGHT})`}>
              {bars.map((bar, i) => {
                const y = i * ROW_HEIGHT;
                const isSummary = bar.row.kind === 'summary';
                return (
                  <g key={bar.row.uid} className="gantt__row">
                    <rect
                      x={0}
                      y={y}
                      width={LABEL_WIDTH + chartWidth}
                      height={ROW_HEIGHT}
                      className="gantt__rowBg"
                    />
                    <text
                      x={8 + (bar.row.depth - 1) * 10}
                      y={y + 15}
                      className={isSummary ? 'gantt__label gantt__label--summary' : 'gantt__label'}
                    >
                      {truncate(
                        `${bar.row.wbsCode}  ${bar.row.name}`,
                        LABEL_WIDTH - (bar.row.depth - 1) * 10,
                      )}
                    </text>
                    <rect
                      x={LABEL_WIDTH + bar.x}
                      y={y + (isSummary ? 8 : 5)}
                      width={bar.width}
                      height={isSummary ? 6 : 12}
                      className={barClass(bar.row.isCritical, isSummary)}
                    >
                      <title>
                        {bar.row.name} · {bar.row.planStart} → {bar.row.planEnd}
                        {bar.row.pic === null ? '' : ` · ${bar.row.pic}`}
                        {bar.row.isCritical ? ' · critical path' : ''}
                      </title>
                    </rect>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
    </section>
  );
}

function barClass(isCritical: boolean, isSummary: boolean): string {
  if (isSummary) return 'gantt__bar gantt__bar--summary';
  // §14.2/P9: "critical path tô đậm".
  return isCritical ? 'gantt__bar gantt__bar--critical' : 'gantt__bar';
}

/** Cắt nhãn theo bề rộng cột — SVG không tự cắt chữ như CSS. */
function truncate(text: string, pixels: number): string {
  const max = Math.max(4, Math.floor(pixels / 6.2));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
