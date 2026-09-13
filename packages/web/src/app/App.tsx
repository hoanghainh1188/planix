import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { WbsTree } from '../components/wbs-tree/WbsTree.js';
import { GanttChart } from '../components/gantt/GanttChart.js';
import { ProgressBoard } from '../components/progress/ProgressBoard.js';
import { IssuePanel } from '../components/issues/IssuePanel.js';
import { RecalcDialog } from '../components/recalc/RecalcDialog.js';
import { SignIn } from '../components/auth/SignIn.js';
import { buildRecalcDiff, type ScheduleSnapshotRow } from '../model/recalc-diff.js';
import { toFriendlyError, trpc } from '../data/client.js';
import { useAsync } from '../data/use-async.js';
import type { GanttRowData, ProgressBoardData, ProjectSummary, WbsRow } from '../data/types.js';
import type { SaveRow } from '../model/progress-model.js';
import './app.css';

/**
 * §10.2: giao diện và thông báo hệ thống bằng **tiếng Anh**, chuỗi hardcode, không i18n
 * động. Chỉ báo cáo Excel mới có tham số `lang` (§11.1).
 */
/** §10.3 — ba màn của MVP mà P8/P9 đã dựng. */
type Screen = 'wbs' | 'gantt' | 'progress';

const SCREENS: ReadonlyArray<{ id: Screen; label: string }> = [
  { id: 'wbs', label: 'WBS' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'progress', label: 'Progress' },
];

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
  const [screen, setScreen] = useState<Screen>('wbs');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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

  const loadGantt = useCallback((): Promise<GanttRowData[]> => {
    if (projectId === null || screen !== 'gantt') return Promise.resolve([]);
    return trpc.gantt.get.query({ projectId });
  }, [projectId, screen]);

  const loadBoard = useCallback((): Promise<ProgressBoardData | null> => {
    if (projectId === null || screen !== 'progress') return Promise.resolve(null);
    return trpc.progress.board.query({ projectId });
  }, [projectId, screen]);

  const tree = useAsync(loadTree, [projectId]);
  const issues = useAsync(loadIssues, [projectId]);
  const gantt = useAsync(loadGantt, [projectId, screen]);
  const board = useAsync(loadBoard, [projectId, screen, savedAt]);

  const rows: WbsRow[] = tree.status === 'ready' ? tree.data : [];
  // Mốc chuẩn của DỰ ÁN (§7.13), không phải hôm nay của máy. Lấy từ danh sách dự án nên
  // Gantt vẽ được vạch mốc chuẩn mà không cần mở màn nhập tiến độ trước.
  const statusDate =
    projects.status === 'ready'
      ? (projects.data.find((p) => p.id === projectId)?.statusDate ?? '')
      : '';

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

  async function saveProgress(rows: readonly SaveRow[]): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      await trpc.progress.save.mutate({ rows: [...rows] });
      // Đổi khoá để `useAsync` nạp lại: sau khi lưu, đề xuất và cờ on-track đều đổi,
      // và đọc lại từ server chắc chắn hơn là tự đoán trạng thái mới ở client (§10.1).
      setSavedAt(String(Date.now()));
    } catch (error) {
      setSaveError(toFriendlyError(error).message);
    } finally {
      setSaving(false);
    }
  }

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

        <nav className="app__screens" aria-label="Screens">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="app__screen"
              aria-current={screen === s.id ? 'page' : undefined}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
            </button>
          ))}
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

      <main className={screen === 'wbs' ? 'app__main' : 'app__main app__main--wide'}>
        {screen === 'wbs' ? (
          tree.status === 'loading' ? (
            <p className="app__state">Loading tasks…</p>
          ) : tree.status === 'error' ? (
            <p className="app__state app__state--error">{tree.error.message}</p>
          ) : rows.length === 0 ? (
            /* Rỗng vì chưa tải xong và rỗng vì dự án chưa có task là hai chuyện khác nhau. */
            <p className="app__state">
              This project has no tasks yet. Import a task list to start.
            </p>
          ) : (
            <WbsTree
              projectId={projectId ?? ''}
              rows={rows}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
            />
          )
        ) : screen === 'gantt' ? (
          gantt.status === 'loading' ? (
            <p className="app__state">Loading schedule…</p>
          ) : gantt.status === 'error' ? (
            <p className="app__state app__state--error">{gantt.error.message}</p>
          ) : (
            <GanttChart rows={gantt.data} statusDate={statusDate} />
          )
        ) : board.status === 'loading' ? (
          <p className="app__state">Loading progress…</p>
        ) : board.status === 'error' ? (
          <p className="app__state app__state--error">{board.error.message}</p>
        ) : board.data === null ? (
          <p className="app__state">Select a project.</p>
        ) : (
          <>
            {saveError !== null ? (
              <p className="app__state app__state--error" role="alert">
                {saveError}
              </p>
            ) : null}
            <ProgressBoard
              key={`${projectId ?? ''}-${savedAt ?? 'initial'}`}
              rows={board.data.rows}
              statusDate={board.data.statusDate}
              saving={saving}
              onSave={(r) => void saveProgress(r)}
            />
          </>
        )}

        {screen === 'wbs' ? (
          <IssuePanel
            issues={issues.status === 'ready' ? issues.data : []}
            onJumpToTask={setSelectedUid}
          />
        ) : null}
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
