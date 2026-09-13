import { useMemo, useState, type JSX } from 'react';
import { WbsTree } from '../components/wbs-tree/WbsTree.js';
import { IssuePanel } from '../components/issues/IssuePanel.js';
import { RecalcDialog } from '../components/recalc/RecalcDialog.js';
import { buildRecalcDiff, type ScheduleSnapshotRow } from '../model/recalc-diff.js';
import { buildMockIssues, buildMockTree, PROJECTS } from '../data/mock.js';
import './app.css';

/**
 * §10.2: giao diện và thông báo hệ thống bằng **tiếng Anh**, chuỗi hardcode, không i18n
 * động. Chỉ báo cáo Excel mới có tham số `lang` (§11.1).
 */
export function App(): JSX.Element {
  const [projectId, setProjectId] = useState(PROJECTS[0]?.id ?? '');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [showRecalc, setShowRecalc] = useState(false);

  const rows = useMemo(() => buildMockTree(6000), []);
  const issues = useMemo(() => buildMockIssues(rows), [rows]);

  /** Bản so sánh mẫu: dựng từ chính cây đang xem để con số có nghĩa. */
  const diff = useMemo(() => {
    const snapshot = (shift: number): ScheduleSnapshotRow[] =>
      rows.slice(0, 400).map((r, i) => ({
        taskUid: r.uid,
        projectId: i % 9 === 0 ? 'P-GEO' : projectId,
        wbsCode: r.wbsCode,
        name: r.name,
        startDate: r.planStart,
        endDate:
          r.planEnd === null || i % 3 !== 0
            ? r.planEnd
            : new Date(Date.parse(r.planEnd) + shift * 86_400_000).toISOString().slice(0, 10),
      }));
    return buildRecalcDiff(snapshot(0), snapshot(6), projectId);
  }, [rows, projectId]);

  const project = PROJECTS.find((p) => p.id === projectId);

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__mark">planix</span>
          <span className="app__tag">WBS</span>
        </div>

        <nav className="app__projects" aria-label="Project switcher">
          {PROJECTS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="app__project"
              aria-current={p.id === projectId ? 'page' : undefined}
              onClick={() => setProjectId(p.id)}
            >
              <span className="app__projectCode">{p.code}</span>
              <span className="app__projectName">{p.name}</span>
              <span className="app__projectRole">{p.role}</span>
            </button>
          ))}
        </nav>

        <div className="app__actions">
          <span className="app__statusDate">基準日 2026-05-11</span>
          <button type="button" className="app__action">
            Import
          </button>
          <button
            type="button"
            className="app__action app__action--primary"
            onClick={() => setShowRecalc(true)}
          >
            Recalculate
          </button>
        </div>
      </header>

      <main className="app__main">
        <WbsTree
          projectId={projectId}
          rows={rows}
          selectedUid={selectedUid}
          onSelect={setSelectedUid}
        />
        <IssuePanel issues={issues} onJumpToTask={setSelectedUid} />
      </main>

      {showRecalc ? (
        <RecalcDialog
          diff={diff}
          onConfirm={() => setShowRecalc(false)}
          onCancel={() => setShowRecalc(false)}
        />
      ) : null}

      <span hidden>{project?.name}</span>
    </div>
  );
}
