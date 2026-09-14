import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { WbsTree, type TaskEdit } from '../components/wbs-tree/WbsTree.js';
import { WbsEmpty } from '../components/wbs-tree/WbsEmpty.js';
import { HeaderActions } from '../components/header/HeaderActions.js';
import { EvmStrip } from '../components/evm/EvmStrip.js';
import { GanttChart } from '../components/gantt/GanttChart.js';
import { ProgressBoard } from '../components/progress/ProgressBoard.js';
import { IssuePanel } from '../components/issues/IssuePanel.js';
import { DependencyPanel, type LinkDirection } from '../components/links/DependencyPanel.js';
import { TaskDetailPanel } from '../components/detail/TaskDetailPanel.js';
import { AdminScreen } from '../components/admin/AdminScreen.js';
import { PoolScreen } from '../components/pool/PoolScreen.js';
import { ImportScreen } from '../components/import/ImportScreen.js';
import { PeriodScreen, type ReportKind } from '../components/period/PeriodScreen.js';
import { can, toProjectRole, type PermissionContext } from '@planix/core/domain/permissions.js';
import { RecalcDialog } from '../components/recalc/RecalcDialog.js';
import { SignIn } from '../components/auth/SignIn.js';
import { buildRecalcDiff, type ScheduleSnapshotRow } from '../model/recalc-diff.js';
import { createProjectStore } from '../model/project-store.js';
import { toFriendlyError, trpc } from '../data/client.js';
import { useAsync } from '../data/use-async.js';
import type {
  BaselineRow,
  CloseResult,
  DependencyType,
  GanttRowData,
  ImportCheck,
  ImportDone,
  BlockingIssue,
  LinkIssue,
  ProgressBoardData,
  ProjectSummary,
  SaveResourceInput,
  TaskDetail,
  TaskLabels,
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
/** §10.3 — ba màn của MVP (P8/P9) cộng S8 Import (P12). */
type Screen = 'wbs' | 'gantt' | 'progress' | 'import' | 'period' | 'admin' | 'pool';

/**
 * Quyền §10.6 mà một màn đòi hỏi để CÓ MẶT trên thanh điều hướng.
 *
 * Không phải cơ chế bảo vệ — §10.6 chốt "kiểm tra quyền ở server, không chỉ ẩn nút trên
 * UI", và router vẫn từ chối. Nó chỉ để người dùng không nhìn thấy một màn mà họ bấm vào
 * đâu cũng bị chặn.
 */
type ScreenGate = 'import_from_ai' | 'export_report' | 'manage_resources' | 'view_resource_pool';

/**
 * Mỗi màn khoá bằng ĐÚNG quyền của nó.
 *
 * Trước đây cả ba màn `pmOnly` dùng chung một cờ, và cờ đó tra bằng `canImport`. Hôm nay
 * `import_from_ai`, `close_period` và `view_resource_pool` tình cờ cùng là `{pm: true,
 * lead: false}` nên không ai thấy gì sai — nhưng chúng là ba dòng khác nhau trong bảng
 * §10.6, và `export_report` thì đã khác ngay từ đầu: lead ĐƯỢC bản `full`.
 */
const SCREENS: ReadonlyArray<{
  id: Screen;
  label: string;
  gate?: ScreenGate;
}> = [
  { id: 'wbs', label: 'WBS' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'progress', label: 'Progress' },
  { id: 'import', label: 'Import', gate: 'import_from_ai' },
  // Lead vào được để lấy báo cáo; phần chốt kỳ bên trong màn tự ẩn (§10.6 `close_period`).
  { id: 'period', label: 'Reports', gate: 'export_report' },
  // §10.3: S5 "nằm ngoài phạm vi dự án — thuộc về tổ chức", và §10.6 đặt
  // `manage_resources` chỉ cho admin. Nên nó không đi theo dự án đang chọn.
  { id: 'admin', label: 'Resources', gate: 'manage_resources' },
  // §10.3 "Admin, PM đọc". Server tra bằng "có làm PM ở ĐÂU ĐÓ không" chứ không theo dự
  // án đang chọn, nên UI phải hỏi cùng một câu, không thì hai bên lệch nhau.
  { id: 'pool', label: 'Pool', gate: 'view_resource_pool' },
];

/**
 * Cột phải của S1 chia hai tab thay vì xếp chồng hai panel.
 *
 * Issues thuộc về CẢ dự án, Links thuộc về MỘT task đang chọn. Cho cả hai cùng hiện thì
 * ở 1024px mỗi panel còn chưa tới mười dòng — mà danh sách issue vốn đã cần cuộn.
 */
type SidePanel = 'issues' | 'links' | 'detail';

export function App(): JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // `/api/me` vẫn luôn trả `isAdmin`, chỉ là trước đây bị bỏ đi. S5 cần nó để biết có
  // hiện tab hay không — vẫn chỉ là ẩn nút, còn chặn thật nằm ở server (§10.6).
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then(async (res) => {
        if (!alive) return;
        setSignedIn(res.ok);
        if (!res.ok) return;
        const body = (await res.json()) as { user?: { isAdmin?: boolean } };
        if (alive) setIsAdmin(body.user?.isAdmin === true);
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
  return <Workspace isAdmin={isAdmin} onSignedOut={() => setSignedIn(false)} />;
}

function Workspace({
  isAdmin,
  onSignedOut,
}: {
  readonly isAdmin: boolean;
  readonly onSignedOut: () => void;
}): JSX.Element {
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
  const [importCheck, setImportCheck] = useState<ImportCheck | null>(null);
  const [importDone, setImportDone] = useState<ImportDone | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<readonly BlockingIssue[] | string | null>(
    null,
  );
  /**
   * Payload đang chờ PM xác nhận vì nó sẽ XOÁ dữ liệu.
   *
   * §12.2 đòi confirm cho việc xoá. Màn Import có cảnh báo đỏ nhưng cảnh báo không phải
   * confirm: nó nằm cạnh một cái nút, và một cú bấm nhầm là mất cả cây con cùng tiến độ
   * trong đó — thứ tính lại không được.
   */
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    taskCount: number;
    progressRows: number;
  } | null>(null);
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

  const loadBaselines = useCallback((): Promise<BaselineRow[]> => {
    if (projectId === null) return Promise.resolve([]);
    return trpc.period.list.query({ projectId });
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

  /** S5 — chỉ tải khi màn đang mở, và chỉ cho admin. */
  const loadAdmin = useCallback(() => {
    if (!isAdmin || screen !== 'admin') return Promise.resolve(null);
    return Promise.all([trpc.admin.overview.query(), trpc.admin.exceptions.query({})]).then(
      ([overview, exceptions]) => ({ ...overview, exceptions }),
    );
  }, [isAdmin, screen]);

  /** S2 — chỉ tải khi tab đang mở: panel này nặng hơn hai tab kia và ít được mở hơn. */
  const loadDetail = useCallback((): Promise<TaskDetail | null> => {
    if (selectedUid === null || sidePanel !== 'detail') return Promise.resolve(null);
    return trpc.wbs.detail.query({ taskUid: selectedUid });
  }, [selectedUid, sidePanel]);

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
  const baselines = useAsync(loadBaselines, [projectId, savedAt]);
  const gantt = useAsync(loadGantt, [projectId, screen]);
  const board = useAsync(loadBoard, [projectId, screen, savedAt]);
  const links = useAsync(loadLinks, [selectedUid, savedAt]);
  const detail = useAsync(loadDetail, [selectedUid, sidePanel, savedAt]);
  const adminData = useAsync(loadAdmin, [isAdmin, screen, savedAt]);

  const rows: WbsRow[] = tree.status === 'ready' ? tree.data : [];
  const selectedRow = rows.find((r) => r.uid === selectedUid) ?? null;
  // Mốc chuẩn của DỰ ÁN (§7.13), không phải hôm nay của máy. Lấy từ danh sách dự án nên
  // Gantt vẽ được vạch mốc chuẩn mà không cần mở màn nhập tiến độ trước.
  const statusDate =
    projects.status === 'ready'
      ? (projects.data.find((p) => p.id === projectId)?.statusDate ?? '')
      : '';
  /**
   * S9 — cửa sổ mặc định: từ `status_date` của dự án đang chọn, 12 tuần tới.
   *
   * Không lấy "hôm nay của máy": §7.13 đặt `status_date` làm mốc chuẩn, và một máy lệch
   * ngày sẽ cho ra bảng khác máy bên cạnh.
   */
  const [poolRange, setPoolRange] = useState<{
    from: string;
    to: string;
    by: 'day' | 'week' | 'month';
  } | null>(null);

  const loadPool = useCallback(() => {
    if (screen !== 'pool' || poolRange === null) return Promise.resolve(null);
    return trpc.pool.load.query(poolRange);
  }, [screen, poolRange]);

  /**
   * Đặt cửa sổ mặc định MỘT lần, khi đã biết `status_date`.
   *
   * Không dùng `useState(...)` với giá trị ban đầu: `status_date` tới sau (nó là một
   * truy vấn riêng), và `useState` chỉ đọc giá trị khởi tạo đúng một lần — đúng lớp lỗi
   * đã hạ S7 hai lần.
   */
  useEffect(() => {
    if (poolRange !== null || statusDate === '') return;
    const start = new Date(`${statusDate}T00:00:00Z`);
    const end = new Date(start.getTime() + 12 * 7 * 86400000);
    setPoolRange({ from: statusDate, to: end.toISOString().slice(0, 10), by: 'week' });
  }, [statusDate, poolRange]);

  const poolData = useAsync(loadPool, [screen, poolRange, savedAt]);

  /**
   * Mọi câu "được hay không" đều HỎI bảng §10.6, không chép lại nó.
   *
   * Trước đây chỗ này là một dãy `projectRole === 'pm'` viết tay, và cả ba lỗi của đợt rà
   * vừa rồi đều sinh ra từ đó: khoá nhầm tên quyền, gộp ba màn vào một cờ, hỏi một câu
   * khác server. Giờ `can()` đến từ `@planix/core` — đúng bảng mà router dùng để từ chối.
   *
   * Vẫn không phải cơ chế bảo vệ: §10.6 chốt "kiểm tra quyền ở server, không chỉ ẩn nút".
   * Đây chỉ để người dùng khỏi bấm vào một bức tường.
   */
  const projectRole =
    projects.status === 'ready' ? projects.data.find((p) => p.id === projectId)?.role : undefined;
  const perm: PermissionContext = { isAdmin, projectRole: toProjectRole(projectRole) };

  const canImport = can('import_from_ai', perm);
  const canEditWbs = can('edit_wbs', perm);
  const canRecalculate = can('recalculate_project', perm);
  const canClosePeriod = can('close_period', perm);

  /**
   * Bảng §10.6 cho lead `export_report` "✅ (bản full)", và `can()` đã mang sẵn tinh chỉnh
   * đó qua `reportKind`. Hỏi từng bản một là để danh sách trên màn hình đi theo bảng: mai
   * kia bảng mở thêm `summary` cho lead thì UI tự có, không phải nhớ sửa ở đây.
   */
  const exportKinds: readonly ReportKind[] = (['full', 'summary', 'resource'] as const).filter(
    (reportKind) => can('export_report', { ...perm, reportKind }),
  );

  /**
   * `view_resource_pool` hỏi "có làm PM ở ĐÂU ĐÓ không", không phải vai ở dự án đang chọn.
   *
   * S9 là màn toàn cục. Server tra đúng như vậy (`pmSomewhere`), nên ở đây phải dựng cùng
   * một `PermissionContext` — tra theo dự án đang chọn thì một người làm PM dự án A, lead
   * dự án B sẽ mất tab Pool chỉ vì đang đứng ở B.
   */
  const pmSomewhere = projects.status === 'ready' && projects.data.some((p) => p.role === 'pm');

  const screenGates: Readonly<Record<ScreenGate, boolean>> = {
    import_from_ai: canImport,
    export_report: exportKinds.length > 0,
    // Màn toàn cục, không thuộc dự án nào — y như router (§10.3).
    manage_resources: can('manage_resources', { isAdmin, projectRole: null }),
    view_resource_pool: can('view_resource_pool', {
      isAdmin,
      projectRole: pmSomewhere ? 'pm' : null,
    }),
  };

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

  /**
   * §10.6: thiếu `edit_wbs` thì cây chỉ để xem — `WbsTree` đã hỗ trợ sẵn chế độ đó bằng cách
   * vắng callback.
   *
   * Server vẫn là chỗ chặn thật (`assertCan('edit_wbs')` trên từng procedure); cái này chỉ
   * là để người không có quyền khỏi phải đâm vào tường mới biết có tường.
   */
  /** §10.6: `setDependency` / `deleteDependency` cũng là `edit_wbs`. */
  const linkWriteHandlers = canEditWbs ? { onAdd: addLink, onRemove: removeLink } : {};

  /**
   * `updateLabels` kiểm `edit_wbs`, không phải `import_from_ai`.
   *
   * Chỗ này từng dùng `canImport`. Kết quả đúng — hai quyền đang cùng một dòng trong bảng
   * §10.6 nên trùng nhau — nhưng đúng vì tình cờ: ngày nào bảng tách hai dòng ra, panel
   * này sẽ hiện hay ẩn theo một quyền chẳng liên quan gì tới nó.
   */
  const labelWriteHandlers = canEditWbs ? { onSave: saveLabels } : {};

  const wbsWriteHandlers = canEditWbs
    ? {
        onEdit: editTask,
        onMove: moveTask,
        onSequencing: setSequencing,
        onCreate: createTask,
        onDelete: deleteTask,
      }
    : {};

  /**
   * Task đầu tiên của một dự án rỗng — không có dòng nào để rê chuột nên cần lối vào riêng.
   *
   * Tạo `summary` chứ không `work` như nút `+after`: gốc của một cây WBS là summary, và chỉ
   * summary mới hiện nút `+child`, nên tạo `work` là dựng sẵn một ngõ cụt. `effortMd` để
   * trống vì effort của summary là rollup từ con (§7.7).
   */
  async function createFirstTask(): Promise<void> {
    if (projectId === null) return;
    setWriteError(null);
    setWriting(true);
    try {
      const created = await trpc.wbs.createTask.mutate({
        projectId,
        parentUid: null,
        name: 'New task',
        kind: 'summary',
        effortMd: null,
        role: null,
        priority: 500,
        afterUid: null,
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

  /**
   * S2 — lưu nhóm nhãn phân loại (quyết định 2026-09-14).
   *
   * Không chạy scheduler: §10.1 nói lịch chỉ đổi khi PM bấm Recalculate và duyệt bảng so
   * sánh trước. Nhãn phân loại không đụng tới ngày, nhưng `afterWrite` vẫn cần vì sửa
   * `phase`/`module` làm đổi tập issue `N03` mà panel Issues đang hiện.
   */
  async function saveLabels(labels: TaskLabels): Promise<void> {
    if (selectedUid === null) return;
    setWriteError(null);
    setWriting(true);
    try {
      await trpc.wbs.updateLabels.mutate({ taskUid: selectedUid, ...labels });
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
      throw error;
    } finally {
      setWriting(false);
    }
  }

  /**
   * S5 — mọi thao tác quản trị đi chung một đường.
   *
   * Dùng lại `afterWrite` để danh sách tự nạp lại. KHÔNG chạy scheduler: §10.1 nói lịch
   * chỉ đổi khi PM bấm Recalculate. Thêm một ngày lễ là đổi dữ liệu ĐẦU VÀO của engine —
   * lịch hiện tại vẫn là lịch cũ cho tới lượt tính kế tiếp, và đó là đúng ý §10.1.
   */
  async function adminWrite(run: () => Promise<unknown>): Promise<void> {
    setWriteError(null);
    setWriting(true);
    try {
      await run();
      afterWrite();
    } catch (error) {
      setWriteError(toFriendlyError(error).message);
      throw error;
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

  // ── S8 — Import (§9) ──────────────────────────────────────────────────────

  /** Đọc chuỗi PM dán vào. Sai cú pháp thì nói ngay, không gửi lên server làm gì. */
  function parsePayload(text: string): unknown {
    return JSON.parse(text);
  }

  async function checkImport(text: string): Promise<void> {
    setImportError(null);
    setImportDone(null);
    setImporting(true);
    try {
      const res = await trpc.wbsImport.dryRun.mutate({ payload: parsePayload(text) });
      setImportCheck(res);
    } catch (error) {
      setImportCheck(null);
      setImportError(
        error instanceof SyntaxError
          ? `That is not valid JSON: ${error.message}`
          : toFriendlyError(error).message,
      );
    } finally {
      setImporting(false);
    }
  }

  /**
   * PM bấm nút nạp. Nếu lần nạp này xoá gì đó thì hỏi lại trước; không thì ghi luôn.
   *
   * Con số lấy từ lần KIỂM vừa rồi, và kết quả kiểm đã bị vứt nếu nội dung thay đổi — nên
   * hộp thoại không bao giờ hiện số của một file khác với file sắp được nạp.
   */
  async function requestImport(text: string): Promise<void> {
    const removing = importCheck !== null && importCheck.ok ? importCheck.removing : null;
    if (removing !== null && removing.taskCount > 0) {
      setPendingImport({ text, ...removing });
      return;
    }
    await commitImport(text);
  }

  async function commitImport(text: string): Promise<void> {
    setPendingImport(null);
    setImportError(null);
    setImporting(true);
    try {
      const res = await trpc.wbsImport.commit.mutate({ payload: parsePayload(text) });
      if (!res.ok) {
        setImportError(res.message);
        return;
      }
      setImportDone(res);
      setImportCheck(null);
      // Nạp xong là cây, lịch sử validate và chấm đỏ đều đổi — đọc lại hết.
      afterWrite();
    } catch (error) {
      setImportError(
        error instanceof SyntaxError
          ? `That is not valid JSON: ${error.message}`
          : toFriendlyError(error).message,
      );
    } finally {
      setImporting(false);
    }
  }

  // ── S7 — chốt kỳ và báo cáo (§7.13, §11) ──────────────────────────────────

  async function closePeriod(statusDate: string, label: string): Promise<void> {
    if (projectId === null) return;
    setClosing(true);
    setCloseResult(null);
    try {
      const res = await trpc.period.close.mutate({ projectId, statusDate, label });
      setCloseResult(res);
      // Chốt xong thì mốc chuẩn, baseline và EVM đều đổi — đọc lại hết.
      if (res.ok) afterWrite();
    } catch (error) {
      // Lỗi mạng hay lỗi quyền: dựng một kết quả "không chốt được" để màn hình hiện cùng
      // một chỗ với lỗi nghiệp vụ, thay vì thêm một đường báo lỗi thứ hai.
      setCloseResult({ ok: false, message: toFriendlyError(error).message, issues: [] });
    } finally {
      setClosing(false);
    }
  }

  /**
   * Tải file qua `fetch` rồi mới dựng link, thay vì trỏ thẳng `<a href>`.
   *
   * Trỏ thẳng thì khi export bị chặn (§11.4 — có Critical là không xuất), trình duyệt sẽ
   * tải về một file JSON lỗi mang tên `.xlsx`. Đọc phản hồi trước cho phép hiện đúng danh
   * sách vấn đề, và chỉ dựng link khi thật sự có file.
   */
  async function downloadReport(
    report: 'full' | 'summary' | 'resource',
    depth: number,
  ): Promise<void> {
    if (projectId === null) return;
    setDownloading(report);
    setDownloadError(null);
    try {
      const params = new URLSearchParams({ project: projectId, report });
      if (report === 'summary') params.set('depth', String(depth));
      const res = await fetch(`/api/export?${params.toString()}`);

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const issues =
          typeof body === 'object' &&
          body !== null &&
          Array.isArray((body as { issues?: unknown }).issues)
            ? (body as { issues: BlockingIssue[] }).issues
            : null;
        setDownloadError(issues ?? `Could not export (HTTP ${String(res.status)}).`);
        return;
      }

      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
        `${report}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      // Thu hồi ngay: giữ object URL sống là giữ cả file trong RAM cho tới khi đóng tab.
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(toFriendlyError(error).message);
    } finally {
      setDownloading(null);
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
          {SCREENS.filter((s) => s.gate === undefined || screenGates[s.gate]).map((s) => (
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

        <HeaderActions
          canRecalculate={canRecalculate}
          busy={previewing}
          hasTasks={rows.length > 0}
          onRecalculate={() => void openRecalc()}
          onSignOut={() => void signOut()}
        />
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
        {screen === 'pool' ? (
          <PoolScreen
            data={poolData.status === 'ready' ? poolData.data : null}
            loading={poolData.status === 'loading'}
            error={poolData.status === 'error' ? poolData.error.message : null}
            from={poolRange?.from ?? ''}
            to={poolRange?.to ?? ''}
            by={poolRange?.by ?? 'week'}
            onRange={(from, to, by) => setPoolRange({ from, to, by })}
          />
        ) : screen === 'admin' ? (
          <AdminScreen
            resources={adminData.status === 'ready' ? (adminData.data?.resources ?? []) : []}
            calendars={adminData.status === 'ready' ? (adminData.data?.calendars ?? []) : []}
            locations={adminData.status === 'ready' ? (adminData.data?.locations ?? []) : []}
            exceptions={adminData.status === 'ready' ? (adminData.data?.exceptions ?? []) : []}
            loading={adminData.status === 'loading'}
            busy={writing}
            error={writeError}
            onSaveResource={(input: SaveResourceInput) =>
              adminWrite(() => trpc.admin.saveResource.mutate(input))
            }
            onAddException={(input) => adminWrite(() => trpc.admin.addException.mutate(input))}
            onAddLeave={(input) => adminWrite(() => trpc.admin.addResourceLeave.mutate(input))}
            onRemoveException={(id: number) =>
              adminWrite(() => trpc.admin.removeException.mutate({ id }))
            }
          />
        ) : screen === 'period' ? (
          /*
           * `key` theo dự án để React DỰNG LẠI màn khi PM đổi dự án.
           *
           * Ô ngày và tên baseline là state khởi tạo từ prop, mà `useState` chỉ đọc giá
           * trị khởi tạo đúng một lần. Không có `key` thì đổi sang dự án khác vẫn giữ
           * nguyên mốc chuẩn và tên gợi ý của dự án CŨ — bấm Close period là lẳng lặng
           * kéo mốc chuẩn về một ngày thuộc dự án khác.
           */
          <PeriodScreen
            key={projectId ?? 'none'}
            statusDate={statusDate}
            baselines={baselines.status === 'ready' ? baselines.data : []}
            closing={closing}
            closeResult={closeResult}
            {...(canClosePeriod ? { onClose: closePeriod } : {})}
            downloading={downloading}
            downloadError={downloadError}
            onDownload={downloadReport}
            reports={exportKinds}
          />
        ) : screen === 'import' ? (
          <ImportScreen
            check={importCheck}
            done={importDone}
            busy={importing}
            error={importError}
            onCheck={checkImport}
            onCommit={requestImport}
            onDirty={() => {
              setImportCheck(null);
              setImportDone(null);
              setImportError(null);
            }}
          />
        ) : screen === 'wbs' ? (
          tree.status === 'loading' ? (
            <p className="app__state">Loading tasks…</p>
          ) : tree.status === 'error' ? (
            <p className="app__state app__state--error">{tree.error.message}</p>
          ) : rows.length === 0 ? (
            /* Rỗng vì chưa tải xong và rỗng vì dự án chưa có task là hai chuyện khác nhau. */
            <WbsEmpty
              canEdit={canEditWbs}
              busy={writing}
              onCreateFirst={() => void createFirstTask()}
            />
          ) : (
            <div className="app__wbs">
              <EvmStrip evm={evm.status === 'ready' ? evm.data : null} />
              <WbsTree
                projectId={projectId ?? ''}
                rows={rows}
                selectedUid={selectedUid}
                onSelect={setSelectedUid}
                {...wbsWriteHandlers}
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
              <button
                type="button"
                role="tab"
                className="app__tab"
                aria-selected={sidePanel === 'detail'}
                onClick={() => setSidePanel('detail')}
              >
                Detail
              </button>
            </div>

            {sidePanel === 'detail' ? (
              <TaskDetailPanel
                // `key` buộc panel dựng lại khi đổi task: bản nháp trong nó phải bị vứt,
                // nếu không thì bấm Save là ghi dữ liệu task cũ đè lên task mới.
                key={selectedUid ?? 'none'}
                detail={detail.status === 'ready' ? detail.data : null}
                loading={detail.status === 'loading'}
                busy={writing}
                {...labelWriteHandlers}
              />
            ) : sidePanel === 'issues' ? (
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
                {...linkWriteHandlers}
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

      {pendingImport !== null ? (
        <div className="app__confirm" role="alertdialog" aria-label="Confirm import">
          <div className="app__confirmBox">
            <h2 className="app__confirmTitle">Replace this subtree?</h2>
            <p className="app__confirmBody">
              This deletes {pendingImport.taskCount}{' '}
              {pendingImport.taskCount === 1 ? 'task' : 'tasks'} before importing.
              {pendingImport.progressRows > 0
                ? ` ${String(pendingImport.progressRows)} progress ${
                    pendingImport.progressRows === 1 ? 'entry' : 'entries'
                  } will be lost — the schedule can be recomputed, but progress people typed cannot.`
                : ''}
            </p>
            <div className="app__confirmActions">
              <button type="button" className="app__action" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="app__action app__action--danger"
                onClick={() => void commitImport(pendingImport.text)}
              >
                Replace and import
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
