import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { WbsTree, type TaskEdit } from '../components/wbs-tree/WbsTree.js';
import { EvmStrip } from '../components/evm/EvmStrip.js';
import { GanttChart } from '../components/gantt/GanttChart.js';
import { ProgressBoard } from '../components/progress/ProgressBoard.js';
import { IssuePanel } from '../components/issues/IssuePanel.js';
import { DependencyPanel, type LinkDirection } from '../components/links/DependencyPanel.js';
import { RecalcDialog } from '../components/recalc/RecalcDialog.js';
import { SignIn } from '../components/auth/SignIn.js';
import { buildRecalcDiff, type ScheduleSnapshotRow } from '../model/recalc-diff.js';
import { createProjectStore } from '../model/project-store.js';
import { toFriendlyError, trpc } from '../data/client.js';
import { useAsync } from '../data/use-async.js';
import type {
  DependencyType,
  GanttRowData,
  LinkIssue,
  ProgressBoardData,
  ProjectSummary,
  TaskLink,
  TaskLinks,
  WbsRow,
} from '../data/types.js';
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

/**
 * Cột phải của S1 chia hai tab thay vì xếp chồng hai panel.
 *
 * Issues thuộc về CẢ dự án, Links thuộc về MỘT task đang chọn. Cho cả hai cùng hiện thì
 * ở 1024px mỗi panel còn chưa tới mười dòng — mà danh sách issue vốn đã cần cuộn.
 */
type SidePanel = 'issues' | 'links';

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
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [editUid, setEditUid] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>('issues');
  /** Phản hồi validate của lần sửa ràng buộc gần nhất (§12.4). */
  const [linkIssues, setLinkIssues] = useState<readonly LinkIssue[]>([]);
  /**
   * Mốc "vừa có một lượt validate", tách khỏi `savedAt` ("vừa ghi dữ liệu").
   *
   * Một lượt tính lịch BỊ CHẶN không ghi được dòng lịch nào — nên `savedAt` không đổi —
   * nhưng nó vẫn sinh ra issue và ghi xuống DB. Dùng chung một khoá thì panel S6 đứng im
   * đúng vào lúc vừa có tin cần đọc nhất.
   */
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  /** Task cần đưa vào tầm mắt. `at` để bấm lại cùng một issue vẫn cuộn lại lần nữa. */
  const [reveal, setReveal] = useState<{ uid: string; at: number } | null>(null);
  /** Lượt validate đang xem. `null` = lượt mới nhất, tức trạng thái hiện tại. */
  const [viewingRunPk, setViewingRunPk] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    uid: string;
    taskCount: number;
    progressRows: number;
  } | null>(null);

  const projects = useAsync<ProjectSummary[]>(() => trpc.projects.list.query(), []);

  const projectStore = useMemo(
    () => createProjectStore(typeof window === 'undefined' ? null : window.localStorage),
    [],
  );

  // §14.2/P8 "nhớ dự án đang chọn": ưu tiên dự án lần trước, nhưng chỉ khi nó CÒN nằm
  // trong danh sách được gán — quyền có thể đã bị thu hồi từ lần vào trước.
  useEffect(() => {
    if (projects.status !== 'ready' || projectId !== null || projects.data.length === 0) return;
    const remembered = projectStore.load();
    const stillThere = projects.data.some((p) => p.id === remembered);
    setProjectId(stillThere && remembered !== null ? remembered : (projects.data[0]?.id ?? null));
  }, [projects, projectId, projectStore]);

  // Phản hồi validate gắn với MỘT lần sửa trên MỘT task. Đổi task mà vẫn để nguyên thì
  // PM đọc cảnh báo của task cũ trên task mới.
  useEffect(() => {
    setLinkIssues([]);
  }, [selectedUid]);

  // `runPk` thuộc về MỘT dự án. Giữ nguyên khi đổi dự án thì panel xin một lượt không
  // tồn tại ở đó và nhận NOT_FOUND.
  useEffect(() => {
    setViewingRunPk(null);
  }, [projectId]);

  function chooseProject(id: string): void {
    setProjectId(id);
    projectStore.save(id);
  }

  const loadTree = useCallback((): Promise<WbsRow[]> => {
    if (projectId === null) return Promise.resolve([]);
    return trpc.wbs.tree.query({ projectId });
  }, [projectId]);

  const loadIssues = useCallback(() => {
    if (projectId === null) return Promise.resolve([]);
    // Xem một lượt cũ thì đọc đúng lượt đó; không thì đọc trạng thái hiện tại.
    return viewingRunPk === null
      ? trpc.issues.list.query({ projectId })
      : trpc.issues.ofRun.query({ projectId, runPk: viewingRunPk });
  }, [projectId, viewingRunPk]);

  const loadLastRun = useCallback(() => {
    if (projectId === null) return Promise.resolve(null);
    return trpc.issues.lastRun.query({ projectId });
  }, [projectId]);

  const loadHistory = useCallback(() => {
    if (projectId === null) return Promise.resolve([]);
    return trpc.issues.history.query({ projectId });
  }, [projectId]);

  const loadGantt = useCallback((): Promise<GanttRowData[]> => {
    if (projectId === null || screen !== 'gantt') return Promise.resolve([]);
    return trpc.gantt.get.query({ projectId });
  }, [projectId, screen]);

  const loadBoard = useCallback((): Promise<ProgressBoardData | null> => {
    if (projectId === null || screen !== 'progress') return Promise.resolve(null);
    return trpc.progress.board.query({ projectId });
  }, [projectId, screen]);

  const loadLinks = useCallback((): Promise<TaskLinks | null> => {
    if (selectedUid === null) return Promise.resolve(null);
    return trpc.wbs.dependencies.query({ taskUid: selectedUid });
  }, [selectedUid]);

  const loadEvm = useCallback(() => {
    if (projectId === null) return Promise.resolve(null);
    return trpc.evm.get.query({ projectId });
  }, [projectId]);

  const tree = useAsync(loadTree, [projectId, savedAt]);
  const evm = useAsync(loadEvm, [projectId, savedAt]);
  // Khoá theo `savedAt`: mỗi lần ghi (lưu tiến độ, tính lại lịch) là một lượt validate
  // mới, nên panel phải đọc lại — nếu không nó hiện ảnh chụp cũ mà trông như hiện thời.
  const issues = useAsync(loadIssues, [projectId, savedAt, validatedAt, viewingRunPk]);
  const lastRun = useAsync(loadLastRun, [projectId, savedAt, validatedAt]);
  const history = useAsync(loadHistory, [projectId, savedAt, validatedAt]);
  const gantt = useAsync(loadGantt, [projectId, screen]);
  const board = useAsync(loadBoard, [projectId, screen, savedAt]);
  const links = useAsync(loadLinks, [selectedUid, savedAt]);

  const rows: WbsRow[] = tree.status === 'ready' ? tree.data : [];
  const selectedRow = rows.find((r) => r.uid === selectedUid) ?? null;
  // Mốc chuẩn của DỰ ÁN (§7.13), không phải hôm nay của máy. Lấy từ danh sách dự án nên
  // Gantt vẽ được vạch mốc chuẩn mà không cần mở màn nhập tiến độ trước.
  const statusDate =
    projects.status === 'ready'
      ? (projects.data.find((p) => p.id === projectId)?.statusDate ?? '')
      : '';

  /**
   * Bản so sánh THẬT: engine chạy thử trên bản sao DB rồi trả về lịch trước và sau.
   *
   * §10.1 bắt hiện bảng này TRƯỚC khi ghi, và "mọi số hiển thị đọc từ schedule, không
   * tính lại ở client" — nên hai đầu dữ liệu đều từ server, ở đây chỉ so sánh.
   */
  const [preview, setPreview] = useState<{
    before: readonly ScheduleSnapshotRow[];
    after: readonly ScheduleSnapshotRow[];
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const diff = useMemo(
    () =>
      preview === null ? null : buildRecalcDiff(preview.before, preview.after, projectId ?? ''),
    [preview, projectId],
  );

  async function openRecalc(): Promise<void> {
    if (projectId === null) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await trpc.wbs.previewRecalculate.mutate({ projectId, scope: 'project' });
      if (!res.result.ok) {
        setPreviewError(res.result.message);
        // Bị chặn vẫn là một lượt validate: engine đã ghi issue xuống, panel phải đọc lại.
        setValidatedAt(String(Date.now()));
        return;
      }
      setPreview({ before: res.before, after: res.after });
      setShowRecalc(true);
    } catch (error) {
      setPreviewError(toFriendlyError(error).message);
    } finally {
      setPreviewing(false);
    }
  }

  /** PM đã xem bảng so sánh và đồng ý — giờ mới thật sự ghi (§10.1). */
  async function commitRecalc(): Promise<void> {
    if (projectId === null) return;
    setShowRecalc(false);
    setPreviewing(true);
    try {
      const res = await trpc.wbs.recalculate.mutate({ projectId, scope: 'project' });
      if (!res.ok) setPreviewError(res.message);
      else setSavedAt(String(Date.now()));
    } catch (error) {
      setPreviewError(toFriendlyError(error).message);
    } finally {
      setPreviewing(false);
      setPreview(null);
    }
  }

  // ── Đường ghi của S1 (§10.4) ──────────────────────────────────────────────

  /**
   * Đọc lại từ server thay vì tự sửa state ở client.
   *
   * Đổi cha khiến engine đánh số lại CẢ dự án (§4.3), nên đoán `wbs_code` mới ở client
   * chắc chắn lệch. Đổi khoá là đủ để `useAsync` nạp lại.
   */
  function afterWrite(): void {
    setSavedAt(String(Date.now()));
  }

  async function editTask(uid: string, edit: TaskEdit): Promise<void> {
    setWriteError(null);
    try {
      await trpc.wbs.updateTask.mutate({ taskUid: uid, ...edit });
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    }
  }

  async function moveTask(
    uid: string,
    newParentUid: string | null,
    newSortOrder: number,
  ): Promise<void> {
    setWriteError(null);
    setWriting(true);
    try {
      await trpc.wbs.moveTask.mutate({ taskUid: uid, newParentUid, newSortOrder });
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

  /**
   * Tạo task với tên tạm rồi mở ngay ô sửa để PM gõ tên thật.
   *
   * Hỏi tên bằng một hộp thoại riêng rồi mới tạo sẽ thêm một bước; cách này để PM gõ
   * thẳng vào đúng dòng vừa hiện ra, giống cách thêm dòng trong bảng tính.
   */
  async function createTask(parentUid: string | null, afterUid: string | null): Promise<void> {
    if (projectId === null) return;
    setWriteError(null);
    setWriting(true);
    try {
      const created = await trpc.wbs.createTask.mutate({
        projectId,
        parentUid,
        name: 'New task',
        kind: 'work',
        effortMd: 1,
        role: null,
        priority: 500,
        afterUid,
      });
      afterWrite();
      setSelectedUid(created.uid);
      setEditUid(created.uid);
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

  async function deleteTask(uid: string): Promise<void> {
    setWriteError(null);
    try {
      // §12.2: nói TRƯỚC sẽ mất gì. Lịch tính lại được, tiến độ do người gõ thì không.
      const preview = await trpc.wbs.subtreePreview.query({ taskUid: uid });
      setPendingDelete({ uid, ...preview });
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;
    setWriting(true);
    try {
      await trpc.wbs.deleteSubtree.mutate({ taskUid: target.uid });
      if (selectedUid === target.uid) setSelectedUid(null);
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

  async function setSequencing(uid: string, mode: 'parallel' | 'sequential'): Promise<void> {
    setWriteError(null);
    setWriting(true);
    try {
      await trpc.wbs.setSequencing.mutate({ taskUid: uid, mode });
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

  // ── Ràng buộc giữa các task (§6) ──────────────────────────────────────────

  /**
   * Hai chiều nhưng một API: "A chặn B" và "B chờ A" là CÙNG một cạnh.
   *
   * Panel cho PM đứng ở task đang chọn mà nối về cả hai phía, nên chỗ này quy về đúng
   * cặp (pred, succ) trước khi gọi — thay vì bắt PM phải chọn đúng task rồi mới nối được.
   */
  function edgeOf(
    direction: LinkDirection,
    otherUid: string,
  ): { predUid: string; succUid: string } {
    const self = selectedUid ?? '';
    return direction === 'before'
      ? { predUid: otherUid, succUid: self }
      : { predUid: self, succUid: otherUid };
  }

  async function addLink(
    direction: LinkDirection,
    otherUid: string,
    type: DependencyType,
    lagDays: number,
  ): Promise<void> {
    if (selectedUid === null) return;
    setWriteError(null);
    setWriting(true);
    try {
      const res = await trpc.wbs.setDependency.mutate({
        ...edgeOf(direction, otherUid),
        type,
        lagDays,
      });
      setLinkIssues(res.issues);
      // Nạp lại panel và cây — KHÔNG chạy scheduler. §10.1: lịch chỉ đổi khi PM bấm
      // Recalculate và duyệt bảng so sánh trước.
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

  async function removeLink(direction: LinkDirection, link: TaskLink): Promise<void> {
    if (selectedUid === null) return;
    setWriteError(null);
    setWriting(true);
    try {
      const res = await trpc.wbs.deleteDependency.mutate({
        ...edgeOf(direction, link.uid),
        type: link.type,
      });
      setLinkIssues(res.issues);
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
    } finally {
      setWriting(false);
    }
  }

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
                  onClick={() => chooseProject(p.id)}
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
            onClick={() => void openRecalc()}
            disabled={rows.length === 0 || previewing}
          >
            {previewing ? 'Calculating…' : 'Recalculate'}
          </button>
        </div>
      </header>

      {(writeError ?? previewError) ? (
        <p className="app__banner app__banner--error" role="alert">
          {writeError ?? previewError}
          <button
            type="button"
            className="app__bannerClose"
            onClick={() => {
              setWriteError(null);
              setPreviewError(null);
            }}
          >
            Dismiss
          </button>
        </p>
      ) : null}

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
            <div className="app__wbs">
              <EvmStrip evm={evm.status === 'ready' ? evm.data : null} />
              <WbsTree
                projectId={projectId ?? ''}
                rows={rows}
                selectedUid={selectedUid}
                onSelect={setSelectedUid}
                onEdit={editTask}
                onMove={moveTask}
                onSequencing={setSequencing}
                onCreate={createTask}
                onDelete={deleteTask}
                editUid={editUid}
                onEditDone={() => setEditUid(null)}
                reveal={reveal}
                busy={writing}
              />
            </div>
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
          <div className="app__side">
            <div className="app__tabs" role="tablist" aria-label="Side panel">
              <button
                type="button"
                role="tab"
                className="app__tab"
                aria-selected={sidePanel === 'issues'}
                onClick={() => setSidePanel('issues')}
              >
                Issues
              </button>
              <button
                type="button"
                role="tab"
                className="app__tab"
                aria-selected={sidePanel === 'links'}
                onClick={() => setSidePanel('links')}
              >
                Links
                {selectedRow !== null && selectedRow.linkCount > 0 ? (
                  <b>{selectedRow.linkCount}</b>
                ) : null}
              </button>
            </div>

            {sidePanel === 'issues' ? (
              <IssuePanel
                issues={issues.status === 'ready' ? issues.data : []}
                lastRun={lastRun.status === 'ready' ? lastRun.data : null}
                history={history.status === 'ready' ? history.data : []}
                viewingRunPk={viewingRunPk}
                onViewRun={setViewingRunPk}
                onJumpToTask={(uid) => {
                  // Chọn thôi là chưa đủ: task bị báo lỗi thường nằm sâu trong một nhánh
                  // đang thu gọn, nên cây phải bung ra và cuộn tới thì mới gọi là "nhảy".
                  setSelectedUid(uid);
                  setReveal({ uid, at: Date.now() });
                }}
              />
            ) : (
              <DependencyPanel
                task={selectedRow}
                links={links.status === 'ready' ? links.data : null}
                loading={links.status === 'loading'}
                rows={rows}
                issues={linkIssues}
                onAdd={addLink}
                onRemove={removeLink}
                busy={writing}
              />
            )}
          </div>
        ) : null}
      </main>

      {pendingDelete !== null ? (
        <div className="app__confirm" role="alertdialog" aria-label="Confirm delete">
          <div className="app__confirmBox">
            <h2 className="app__confirmTitle">Delete this task?</h2>
            <p className="app__confirmBody">
              {pendingDelete.taskCount === 1
                ? 'This removes 1 task.'
                : `This removes ${String(pendingDelete.taskCount)} tasks, including everything inside it.`}
              {pendingDelete.progressRows > 0
                ? ` ${String(pendingDelete.progressRows)} progress ${
                    pendingDelete.progressRows === 1 ? 'entry' : 'entries'
                  } will be lost — the schedule can be recomputed, but progress people typed cannot.`
                : ''}
            </p>
            <div className="app__confirmActions">
              <button type="button" className="app__action" onClick={() => setPendingDelete(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="app__action app__action--danger"
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRecalc && diff !== null ? (
        <RecalcDialog
          diff={diff}
          onConfirm={() => void commitRecalc()}
          onCancel={() => {
            setShowRecalc(false);
            setPreview(null);
          }}
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
