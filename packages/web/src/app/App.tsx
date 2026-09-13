import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { WbsTree } from '../components/wbs-tree/WbsTree.js';
import { IssuePanel } from '../components/issues/IssuePanel.js';
import { RecalcDialog } from '../components/recalc/RecalcDialog.js';
import { SignIn } from '../components/auth/SignIn.js';
import { buildRecalcDiff, type ScheduleSnapshotRow } from '../model/recalc-diff.js';
import { trpc } from '../data/client.js';
import { useAsync } from '../data/use-async.js';
import type { ProjectSummary, WbsRow } from '../data/types.js';
import './app.css';

/**
 * §10.2: giao diện và thông báo hệ thống bằng **tiếng Anh**, chuỗi hardcode, không i18n
 * động. Chỉ báo cáo Excel mới có tham số `lang` (§11.1).
 */
export function App(): JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then((res) => {
        if (alive) setSignedIn(res.ok);
      })
      .catch(() => {
        if (alive) setSignedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn === null) return <main className="app__boot">Loading…</main>;
  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;
  return <Workspace onSignedOut={() => setSignedIn(false)} />;
}

function Workspace({ onSignedOut }: { readonly onSignedOut: () => void }): JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [showRecalc, setShowRecalc] = useState(false);

  const projects = useAsync<ProjectSummary[]>(() => trpc.projects.list.query(), []);

  // Chọn dự án đầu tiên khi danh sách về, nếu người dùng chưa chọn gì.
  useEffect(() => {
    if (projects.status === 'ready' && projectId === null && projects.data.length > 0) {
      setProjectId(projects.data[0]?.id ?? null);
    }
  }, [projects, projectId]);

  const loadTree = useCallback((): Promise<WbsRow[]> => {
    if (projectId === null) return Promise.resolve([]);
    return trpc.wbs.tree.query({ projectId });
  }, [projectId]);

  const loadIssues = useCallback(() => {
    if (projectId === null) return Promise.resolve([]);
    return trpc.issues.list.query({ projectId });
  }, [projectId]);

  const tree = useAsync(loadTree, [projectId]);
  const issues = useAsync(loadIssues, [projectId]);

  const rows: WbsRow[] = tree.status === 'ready' ? tree.data : [];

  /** Bản so sánh dựng từ chính cây đang xem, để con số có nghĩa với dữ liệu thật. */
  const diff = useMemo(() => {
    const snapshot = (shift: number): ScheduleSnapshotRow[] =>
      rows.slice(0, 400).map((r, i) => ({
        taskUid: r.uid,
        projectId: projectId ?? '',
        wbsCode: r.wbsCode,
        name: r.name,
        startDate: r.planStart,
        endDate:
          r.planEnd === null || i % 3 !== 0
            ? r.planEnd
            : new Date(Date.parse(r.planEnd) + shift * 86_400_000).toISOString().slice(0, 10),
      }));
    return buildRecalcDiff(snapshot(0), snapshot(6), projectId ?? '');
  }, [rows, projectId]);

  async function signOut(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
    onSignedOut();
  }

  if (projects.status === 'error') {
    return <ErrorScreen message={projects.error.message} />;
  }

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__mark">planix</span>
          <span className="app__tag">WBS</span>
        </div>

        <nav className="app__projects" aria-label="Project switcher">
          {projects.status === 'ready'
            ? projects.data.map((p) => (
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
              ))
            : null}
        </nav>

        <div className="app__actions">
          <button type="button" className="app__action" onClick={() => void signOut()}>
            Sign out
          </button>
          <button
            type="button"
            className="app__action app__action--primary"
            onClick={() => setShowRecalc(true)}
            disabled={rows.length === 0}
          >
            Recalculate
          </button>
        </div>
      </header>

      <main className="app__main">
        {tree.status === 'loading' ? (
          <p className="app__state">Loading tasks…</p>
        ) : tree.status === 'error' ? (
          <p className="app__state app__state--error">{tree.error.message}</p>
        ) : rows.length === 0 ? (
          /* Rỗng vì chưa tải xong và rỗng vì dự án chưa có task là hai chuyện khác nhau. */
          <p className="app__state">This project has no tasks yet. Import a task list to start.</p>
        ) : (
          <WbsTree
            projectId={projectId ?? ''}
            rows={rows}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
          />
        )}

        <IssuePanel
          issues={issues.status === 'ready' ? issues.data : []}
          onJumpToTask={setSelectedUid}
        />
      </main>

      {showRecalc ? (
        <RecalcDialog
          diff={diff}
          onConfirm={() => setShowRecalc(false)}
          onCancel={() => setShowRecalc(false)}
        />
      ) : null}
    </div>
  );
}

function ErrorScreen({ message }: { readonly message: string }): JSX.Element {
  return (
    <main className="app__state app__state--error" role="alert">
      {message}
    </main>
  );
}
