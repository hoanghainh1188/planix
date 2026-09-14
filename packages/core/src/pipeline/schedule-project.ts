/**
 * Đường ống lập lịch — SPEC.md §7.1.
 *
 * Nối các mảnh của P2–P5 thành một lần chạy hoàn chỉnh, theo đúng ba pha:
 *
 *   Chuẩn bị : mở rộng cạnh ảo, bắc cầu task huỷ, chia cụm và topo sort, tính duration
 *   Pha A    : CPM, nguồn lực vô hạn → ES/EF/LS/LF, float, critical path
 *   Pha B    : Serial SGS theo cụm, áp ràng buộc nhân sự thật
 *   Pha C    : ghi kết quả
 *
 * §3.1: toàn bộ tính trong RAM, chỉ ghi DB trong MỘT transaction ngắn ở cuối.
 */

import {
  bridgeCancelled,
  buildClusters,
  buildVirtualEdges,
  expandSummaryEdgesCompact,
  type DepEdge,
} from '../domain/dependency.js';
import { createCalendarEngine, type CalendarEngine } from '../domain/calendar.js';
import { runCpm, type CpmTask } from '../domain/cpm.js';
import {
  checkMilestonesOnHolidays,
  checkPhaseSkew,
  checkResourceUtilisation,
  checkThinAllocations,
  type AuditTask,
} from '../domain/schedule-audit.js';
import { reforecast, type ReforecastTask } from '../domain/reforecast.js';
import { runSgs, type SgsResource, type SgsTask, type SgsScheduleRow } from '../domain/sgs.js';
import { resourceCriticalPath } from '../domain/resource-critical.js';
import { validate } from '../domain/validator.js';
import { recordValidationRun, type RecordedIssue } from '../db/repo/issue-repo.js';
import type { ValidationReport } from '../domain/validation-types.js';
import type { DateOnly } from '../domain/date-only.js';
import type { Db } from '../db/migrate.js';
import * as importRepo from '../db/repo/import-repo.js';
import { loadCalendarSnapshot } from '../db/repo/calendar-repo.js';
import * as scheduleRepo from '../db/repo/schedule-repo.js';

export class ScheduleBlockedError extends Error {
  readonly report: ValidationReport;
  constructor(report: ValidationReport) {
    const codes = [
      ...new Set(report.issues.filter((i) => i.severity === 'Critical').map((i) => i.code)),
    ].sort();
    super(`Cannot schedule: ${codes.join(', ')}`);
    this.name = 'ScheduleBlockedError';
    this.report = report;
  }
}

export interface ScheduleOptions {
  readonly projectId: string;
  readonly runId: string;
  /** Thời điểm ghi `computed_at`. Truyền từ ngoài — core không đọc đồng hồ (N2). */
  readonly now: string;
  /** Số ngày cửa sổ lập lịch. §1.5 thiết kế 400 ngày làm việc. */
  readonly windowDays?: number;
  /**
   * Coi assignment của dự án khác là đã chiếm chỗ (§7.12). Mặc định BẬT.
   *
   * Tắt là bỏ qua TOÀN BỘ dự án khác. Để bỏ qua có chọn lọc, dùng `pendingProjects`.
   */
  readonly respectOtherProjects?: boolean;
  /**
   * Dự án sẽ được xếp lại ở phần sau của CÙNG lượt "Recalculate all".
   *
   * Lịch hiện có của chúng là output của lượt chạy trước, sắp bị ghi đè, nên không phải
   * chỗ đã bị chiếm thật — §7.12 nói các dự án tranh pool theo `priority`, mà tranh với
   * một cái bóng sắp biến mất thì không còn là thứ tự ưu tiên nữa.
   *
   * Bỏ trống khi xếp một dự án lẻ: lúc đó mọi dự án khác đều đang giữ chỗ thật.
   */
  readonly pendingProjects?: readonly string[];
  /**
   * Khi nào chạy `J06` — rule DUY NHẤT đọc pool toàn cục thay vì dữ liệu của dự án này.
   *
   * `'inline'` (mặc định) hợp với "Recalculate this project": ghi xong lịch là pool đã ở
   * trạng thái cuối, đếm ngay được.
   *
   * `'defer'` dành cho "Recalculate all": lúc xếp dự án thứ nhất thì dự án thứ hai vẫn
   * mang assignment của lượt trước, đếm ngay sẽ ra một con số không thuộc lượt nào cả.
   * Khi hoãn, hàm này KHÔNG ghi `validation_run` mà trả về `deferred` để người gọi đếm
   * lại và ghi sau, khi cả lượt đã xong.
   */
  readonly poolAudit?: 'inline' | 'defer';
}

/**
 * Phần việc `scheduleProject` để lại cho người gọi khi `poolAudit: 'defer'`.
 *
 * Mang theo đủ đầu vào của `J06` tại thời điểm xếp lịch — chỉ riêng bảng `assignment` là
 * đọc lại lúc đếm, vì đó chính là thứ cần chờ ổn định.
 */
export interface DeferredPoolAudit {
  readonly projectId: string;
  readonly runId: string;
  readonly detectedAt: string;
  /** Mọi issue đã biết, trừ `J06`. */
  readonly recorded: readonly RecordedIssue[];
  /** Chỉ người CÓ làm dự án này (§8.3). */
  readonly resourceIds: readonly string[];
  readonly windowStart: DateOnly;
  readonly windowEnd: DateOnly | null;
}

export interface ScheduleIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly taskUid?: string;
  /**
   * Dữ liệu kèm theo, để lớp trên đi sâu mà không phải tra lại.
   *
   * Trước đây bị vứt mất khi chuyển từ `SgsIssue` sang đây, và không ai nhận ra vì chưa
   * issue nào của pipeline cần tới nó. `J14` gộp theo cặp thì cần: thông điệp chỉ nói
   * "đẩy 10 task", còn danh sách 10 uid nằm ở đây.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ScheduleResult {
  readonly report: ValidationReport;
  readonly scheduledCount: number;
  readonly assignedCount: number;
  readonly issues: readonly ScheduleIssue[];
  /** §3.1 đặt ngưỡng 200 ms cho write lock. */
  readonly writeLockMs: number;
  readonly projectEnd: DateOnly | null;
  /** Chỉ có khi `poolAudit: 'defer'` — xem `DeferredPoolAudit`. */
  readonly deferred?: DeferredPoolAudit;
}

/** §7.2 — duration danh nghĩa, làm tròn LÊN bội số 0.5. */
function nominalDuration(effortMd: number): number {
  return Math.ceil(effortMd * 2) / 2;
}

export function scheduleProject(db: Db, options: ScheduleOptions): ScheduleResult {
  const settings = scheduleRepo.loadProjectSettings(db, options.projectId);
  if (settings === undefined) throw new Error(`Unknown project: ${options.projectId}`);

  const windowDays = options.windowDays ?? 600;
  const lagCalendarId = scheduleRepo.loadLagCalendarId(db, settings.defaultLocation);

  // ── Validate trước: §8 chạy sau mỗi lần import, schedule và lưu progress ───
  const runValidate = (): ValidationReport =>
    validate({
      runId: options.runId,
      projectId: settings.id,
      tasks: importRepo.loadTasks(db, settings.id),
      dependencies: importRepo.loadDependencies(db, settings.id),
      resources: importRepo.loadResources(db),
      resourceRoles: importRepo.loadResourceRoles(db),
      progress: importRepo.loadProgress(db, settings.id),
      dependencyMaxLevel: settings.dependencyMaxLevel,
      schedule: importRepo.loadSchedule(db, settings.id),
      ...importRepo.loadProjectDates(db, settings.id),
    });

  const report = runValidate();
  if (!report.passed) {
    // Ghi TRƯỚC khi ném. Bị chặn là đúng lúc PM cần biết vì sao nhất, và `scheduleProject`
    // thoát ra ở đây nên không còn chỗ nào khác để ghi. Hàm này tự mở transaction riêng,
    // tách khỏi transaction ghi lịch ở pha C — nên vết chẩn đoán ở lại kể cả khi lượt
    // chạy không ghi được dòng lịch nào.
    recordValidationRun(db, {
      runId: options.runId,
      projectId: settings.id,
      detectedAt: options.now,
      source: 'schedule',
      issues: report.issues,
    });
    throw new ScheduleBlockedError(report);
  }

  const issues: ScheduleIssue[] = [];

  // §7.12 "việc đang chạy không bị dời": đọc người đang làm TRƯỚC khi §4.3 xoá bảng
  // assignment ở cuối lượt. Không đọc trước thì thông tin này mất vĩnh viễn.
  const runningAssignees = scheduleRepo.loadRunningAssignees(db, settings.id);

  const engine = createCalendarEngine(loadCalendarSnapshot(db));
  const depTasks = scheduleRepo.loadDepTasks(db, settings.id);
  const facts = scheduleRepo.loadSchedulingFacts(db, settings.id);
  const factByUid = new Map(facts.map((f) => [f.uid, f]));

  // ── Chuẩn bị ───────────────────────────────────────────────────────────────
  const declared: DepEdge[] = importRepo
    .loadDependencies(db, settings.id)
    .map((d) => ({ predUid: d.predUid, succUid: d.succUid, type: d.type, lagDays: d.lagDays }));

  // Cạnh ảo của cụm `sequential` sinh lúc chạy, không ghi DB (§6.3).
  const withVirtual = [...declared, ...buildVirtualEdges(depTasks)];

  // Bắc cầu qua task đã huỷ (§6.5). Cạnh không ghép được sinh N07.
  const bridged = bridgeCancelled(depTasks, withVirtual);
  for (const i of bridged.issues) {
    issues.push({ code: i.code, severity: i.severity, message: i.message });
  }

  // Cụm dùng cạnh Ở MỨC SUMMARY; ràng buộc mức lá dùng bản đã mở rộng (§6.2).
  const clusters = buildClusters(depTasks, bridged.edges, settings.dependencyMaxLevel);

  // Dạng GỌN: cạnh summary đi qua một nút gộp duration 0 thay vì nở tích Descartes.
  // Với cụm 100 lá mỗi bên, dạng đầy đủ cho 10.000 cạnh mỗi dependency — đủ để CPM
  // trên 6.000 task mất hàng chục giây, đúng thứ cơ chế cụm của §6.2 sinh ra để tránh.
  const expansion = expandSummaryEdgesCompact(depTasks, bridged.edges);
  const leafEdges = expansion.edges;

  // Nút gộp thuộc về cụm của phía predecessor: nó có nghĩa "mọi lá của A đã xong", nên
  // phải được xếp trong lượt của cụm A, trước khi cụm B bắt đầu.
  const clusterOfTask = new Map<string, string>();
  for (const c of clusters) for (const uid of c.leafUids) clusterOfTask.set(uid, c.uid);
  const joinCluster = new Map<string, string>();
  for (const node of expansion.syntheticNodes) {
    const firstPred = leafEdges.find((e) => e.succUid === node.uid)?.predUid;
    const cluster = firstPred === undefined ? undefined : clusterOfTask.get(firstPred);
    if (cluster !== undefined) joinCluster.set(node.uid, cluster);
  }

  // ── Re-forecast: bao nhiêu việc còn lại, và ràng buộc gì từ thực tế (§7.11) ─
  const reforecastInput: ReforecastTask[] = facts
    .filter((f) => f.kind !== 'summary')
    .map((f) => ({
      uid: f.uid,
      effortMd: f.effortMd ?? 0,
      status: f.status as ReforecastTask['status'],
      percent: f.percent,
      remainingMd: f.remainingMd,
      actualStart: f.actualStart,
      actualEnd: f.actualEnd,
    }));
  const forecast = reforecast(reforecastInput, settings.statusDate);
  for (const i of forecast.issues) {
    issues.push({ code: i.code, severity: i.severity, message: i.message, taskUid: i.taskUid });
  }

  // ── Pha A — CPM, nguồn lực vô hạn (§7.2) ──────────────────────────────────
  const cpmTasks: CpmTask[] = [];
  for (const f of facts) {
    if (f.kind === 'summary') continue;
    const row = forecast.get(f.uid);
    if (row === undefined || row.mode === 'excluded') continue;
    cpmTasks.push({
      uid: f.uid,
      durationDays: nominalDuration(row.remainingMd),
      constraintType: f.constraintType,
      constraintDate: f.constraintDate,
    });
  }
  // Nút gộp vào CPM như mốc duration 0 — chúng chỉ truyền ràng buộc, không có việc.
  for (const node of expansion.syntheticNodes) {
    cpmTasks.push({
      uid: node.uid,
      durationDays: 0,
      constraintType: null,
      constraintDate: null,
    });
  }

  const scheduledUids = new Set(cpmTasks.map((t) => t.uid));
  const cpmEdges = leafEdges.filter(
    (e) => scheduledUids.has(e.predUid) && scheduledUids.has(e.succUid),
  );
  const cpm = runCpm({
    tasks: cpmTasks,
    edges: cpmEdges,
    projectStart: settings.startDate,
    calendarId: lagCalendarId,
    engine,
  });

  // ── Pha B — Serial SGS theo cụm (§7.3) ────────────────────────────────────
  const capabilities = scheduleRepo.loadResourceCapabilities(db);
  const roleMap = new Map<string, Record<string, number>>();
  const parallelMap = new Map<string, number>();
  for (const c of capabilities) {
    const roles = roleMap.get(c.resourceId) ?? {};
    roles[c.role] = c.proficiency;
    roleMap.set(c.resourceId, roles);
    parallelMap.set(c.resourceId, c.maxParallel ?? settings.defaultMaxParallel);
  }
  const resources: SgsResource[] = [...roleMap.entries()]
    .map(([id, roles]) => ({
      id,
      roles,
      maxParallel: parallelMap.get(id) ?? settings.defaultMaxParallel,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const sgsTasks: SgsTask[] = [];
  const joinUids = new Set(expansion.syntheticNodes.map((n) => n.uid));

  // Nút gộp cũng phải qua SGS, nếu không ràng buộc giữa hai cụm biến mất ở pha B: cụm
  // sau được xếp SAU về thứ tự duyệt, nhưng ngày tháng sẽ không bị chặn gì cả.
  for (const node of expansion.syntheticNodes) {
    const cpmRow = cpm.get(node.uid);
    if (cpmRow === undefined) continue;
    sgsTasks.push({
      uid: node.uid,
      wbsCode: '~',
      clusterUid: joinCluster.get(node.uid) ?? '<all>',
      kind: 'milestone',
      priority: 1,
      role: null,
      effortMd: 0,
      pinnedResource: null,
      constraintType: null,
      constraintDate: null,
      ls: cpmRow.ls,
      totalFloat: cpmRow.totalFloat,
    });
  }

  for (const t of cpmTasks) {
    if (joinUids.has(t.uid)) continue;
    const f = factByUid.get(t.uid);
    const row = forecast.get(t.uid);
    const cpmRow = cpm.get(t.uid);
    if (f === undefined || row === undefined || cpmRow === undefined) continue;
    // Task done đã cố định ngày thật, không đưa vào SGS (§7.11).
    if (row.mode === 'fixed') continue;
    sgsTasks.push({
      uid: t.uid,
      wbsCode: f.wbsCode,
      clusterUid: clusterOfTask.get(t.uid) ?? '<all>',
      kind: f.kind === 'milestone' ? 'milestone' : 'work',
      priority: f.priority,
      role: f.role,
      effortMd: row.remainingMd,
      // Người đang làm dở được ghim lại. Không ghim thì mỗi lần recalculate,
      // RESOURCE_KEY có thể trao task cho người khác chỉ vì họ rảnh hơn, và PM thấy
      // nhân sự nhảy loạn giữa các tuần mà không hiểu vì sao.
      pinnedResource: f.pinnedResource ?? runningAssignees.get(t.uid) ?? null,
      constraintType: f.constraintType,
      constraintDate: f.constraintDate,
      ls: cpmRow.ls,
      totalFloat: cpmRow.totalFloat,
    });
  }

  const sgsUids = new Set(sgsTasks.map((t) => t.uid));
  const extraByCluster = new Map<string, string[]>();
  for (const [joinUid, clusterUid] of joinCluster) {
    if (!sgsUids.has(joinUid)) continue;
    const list = extraByCluster.get(clusterUid);
    if (list === undefined) extraByCluster.set(clusterUid, [joinUid]);
    else list.push(joinUid);
  }

  const externalReservations =
    options.respectOtherProjects === false
      ? []
      : scheduleRepo
          .loadExternalAssignments(db, [settings.id, ...(options.pendingProjects ?? [])])
          .map((a) => ({
            resourceId: a.resourceId,
            fromDate: a.fromDate,
            toDate: a.toDate,
            allocation: a.allocation,
            projectId: a.projectId,
          }));

  // Đặt tên cho tập cạnh SGS dùng: pha C phải tính mốc ép trên ĐÚNG tập này. Lọc lại
  // một lần nữa ở dưới sẽ là hai định nghĩa song song, và chúng sẽ trôi khỏi nhau.
  const sgsEdges = leafEdges.filter((e) => sgsUids.has(e.predUid) && sgsUids.has(e.succUid));

  const sgs = runSgs({
    externalReservations,
    projectId: settings.id,
    clusters: clusters.map((c) => ({
      uid: c.uid,
      leafUids: [
        ...c.leafUids.filter((uid) => sgsUids.has(uid)),
        ...(extraByCluster.get(c.uid) ?? []),
      ],
    })),
    tasks: sgsTasks,
    edges: sgsEdges,
    resources,
    engine,
    calendarId: lagCalendarId,
    projectStart: settings.startDate,
    statusDate: settings.statusDate,
    minAllocation: settings.minAllocation,
    defaultMaxParallel: settings.defaultMaxParallel,
    windowDays,
  });
  for (const i of sgs.issues) {
    issues.push({
      code: i.code,
      severity: i.severity,
      message: i.message,
      // exactOptionalPropertyTypes: chỉ thêm khoá khi thật sự có giá trị, không gán undefined.
      ...(i.taskUid === undefined ? {} : { taskUid: i.taskUid }),
      ...(i.detail === undefined ? {} : { detail: i.detail }),
    });
  }

  // Task `done` giữ nguyên ngày thật, ghép vào cùng bảng kết quả (§7.11).
  //
  // Hai bản: `fullSchedule` CÓ nút gộp, `schedule` thì không.
  //
  // Nút gộp là cấu trúc nội bộ, không có dòng `task` nên không ghi ra DB được — nhưng
  // trong đồ thị SGS nó là một nút thật, và nhiều chuỗi ràng buộc đi XUYÊN QUA nó. Tính
  // đường găng trên bản đã gỡ nút gộp là tính trên một đồ thị thủng lỗ: mỗi chỗ thủng
  // cắt đứt chuỗi, và toàn bộ phần phía trước biến mất khỏi kết quả.
  //
  // Đo được trên dev.db: chỉ MỘT nút gộp trên đường đi đã cắt chuỗi UTG từ 9 tháng
  // xuống còn 6 tuần cuối.
  const fullSchedule = new Map<string, SgsScheduleRow>(sgs.schedule);
  const schedule = new Map<string, SgsScheduleRow>();
  for (const [uid, row] of sgs.schedule) {
    if (joinUids.has(uid)) continue;
    schedule.set(uid, row);
  }
  for (const [uid, row] of forecast.rows) {
    if (row.mode !== 'fixed') continue;
    if (row.fixedStart === null || row.fixedEnd === null) continue;
    const fixed: SgsScheduleRow = {
      startDate: row.fixedStart,
      endDate: row.fixedEnd,
      durationDays: engine.workingDaysBetween(lagCalendarId, row.fixedStart, row.fixedEnd) + 1,
      delayReason: null,
      blockingRef: null,
    };
    schedule.set(uid, fixed);
    fullSchedule.set(uid, fixed);
  }

  // ── Pha C — bước C1: đường găng sau khi san tài nguyên (§7) ───────────────
  //
  // Tính TRƯỚC khi ghi để nó vào cùng một transaction với phần còn lại của lịch: hai
  // thao tác ghi riêng sẽ có một khoảnh khắc lịch mới đi cùng cờ găng cũ.
  const { critical: resourceCritical, nearCritical: resourceNearCritical } = resourceCriticalPath({
    schedule: fullSchedule,
    edges: sgsEdges,
    assignments: sgs.assignments,
    engine,
    calendarId: lagCalendarId,
  });

  // ── Pha C — ghi kết quả trong một transaction ngắn (§3.1, §4.3) ───────────
  const { writeLockMs } = scheduleRepo.writeScheduleResults(db, {
    projectId: settings.id,
    computedAt: options.now,
    cpm,
    schedule,
    assignments: sgs.assignments,
    resourceCritical,
    resourceNearCritical,
  });

  let projectEnd: DateOnly | null = null;
  for (const row of schedule.values()) {
    if (projectEnd === null || row.endDate > projectEnd) projectEnd = row.endDate;
  }

  // ── §8.2/§8.3 — những rule chỉ trả lời được khi đã có lịch và phân bổ ──────
  //
  // Chạy ở đây chứ không trong `validate()`: chúng là tính chất của KẾT QUẢ, không của
  // dữ liệu đầu vào. Xem `domain/schedule-audit.ts`.
  let phaseAEnd: DateOnly | null = null;
  for (const row of cpm.values()) {
    if (phaseAEnd === null || row.ef > phaseAEnd) phaseAEnd = row.ef;
  }

  // §5.4: location của task → của người được gán → lùi về `default_location` của dự án.
  // Bước lùi cuối nằm ở đây vì chỉ pipeline mới biết `default_location`.
  const locationByUid = new Map(
    scheduleRepo
      .loadTaskLocations(db, settings.id)
      .map((r) => [r.uid, r.locationId ?? settings.defaultLocation]),
  );
  const auditTasks: AuditTask[] = facts.map((f) => ({
    uid: f.uid,
    wbsCode: f.wbsCode,
    kind: f.kind,
    locationId: locationByUid.get(f.uid) ?? settings.defaultLocation,
  }));
  const auditSchedule = [...schedule.entries()].map(([taskUid, row]) => ({
    taskUid,
    startDate: row.startDate,
    endDate: row.endDate,
  }));

  for (const i of [
    ...checkPhaseSkew({
      phaseAEnd,
      phaseBEnd: projectEnd,
      projectStart: settings.startDate,
      workingDaysBetween: (a, b) => engine.workingDaysBetween(lagCalendarId, a, b) + 1,
    }),
    ...checkMilestonesOnHolidays({
      tasks: auditTasks,
      schedule: auditSchedule,
      isWorkingAtLocation: (locationId, date) =>
        engine.isWorkingAtLocation(locationId ?? settings.defaultLocation, date),
      nextWorkingDayAtLocation: (locationId, date) =>
        engine.nextWorkingDayAtLocation(locationId ?? settings.defaultLocation, date),
    }),
    ...checkThinAllocations({
      tasks: auditTasks,
      assignments: sgs.assignments,
      workingDaysBetween: (a, b) => engine.workingDaysBetween(lagCalendarId, a, b) + 1,
    }),
    // `J06` chạy ở cuối hàm hoặc ở người gọi, tuỳ `poolAudit` — nó là rule duy nhất đọc
    // pool toàn cục, nên cần pool đã ổn định mới đếm đúng.
  ]) {
    issues.push({
      code: i.code,
      severity: i.severity,
      message: i.message,
      ...(typeof i.detail?.['taskUid'] === 'string' ? { taskUid: i.detail['taskUid'] } : {}),
    });
  }

  // §8 "chạy sau mỗi lần schedule" — và SAU nghĩa là sau, nên chạy LẠI ở đây.
  //
  // `report` phía trên là cửa chặn: nó phải chạy trước để từ chối Critical, nên nó mô tả
  // lịch CŨ. Từ khi có `J11`/`J03`/`J04` thì khác biệt đó thành sai lệch thật: vừa xếp
  // lại lịch xong mà panel vẫn báo quá hạn theo ngày của lượt trước.
  //
  // Thêm một lượt validate tốn khoảng 5 ms trên 6.000 task — rẻ hơn nhiều so với việc PM
  // đọc một con số không còn đúng.
  const afterSchedule = runValidate();

  // Gộp hai nguồn: validate trên dữ liệu, và issue chỉ lộ ra KHI xếp lịch (N07 bắc cầu
  // hỏng, J01 overallocate...). Với PM đọc màn S6 thì cả hai đều là vấn đề của dự án.
  const toRecorded = (list: readonly ScheduleIssue[]): RecordedIssue[] =>
    list.map((i) => ({
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.taskUid === undefined ? {} : { taskUid: i.taskUid }),
    }));

  // `J06` cần pool đã ổn định. Người gọi một dự án lẻ thì pool ổn định ngay tại đây; người
  // gọi "Recalculate all" phải chờ hết lượt, nên nhận `deferred` và tự đếm sau.
  const poolAudit: DeferredPoolAudit = {
    projectId: settings.id,
    runId: options.runId,
    detectedAt: options.now,
    recorded: [...afterSchedule.issues, ...toRecorded(issues)],
    resourceIds: [...new Set(sgs.assignments.map((a) => a.resourceId))],
    windowStart: settings.statusDate,
    windowEnd: projectEnd,
  };

  if (options.poolAudit === 'defer') {
    return {
      report,
      scheduledCount: schedule.size,
      assignedCount: sgs.assignments.length,
      issues,
      writeLockMs,
      projectEnd,
      deferred: poolAudit,
    };
  }

  const utilisation = poolUtilisationIssues(db, poolAudit, engine);
  recordValidationRun(db, {
    runId: options.runId,
    projectId: settings.id,
    detectedAt: options.now,
    source: 'schedule',
    issues: [...poolAudit.recorded, ...toRecorded(utilisation)],
  });

  return {
    report,
    scheduledCount: schedule.size,
    assignedCount: sgs.assignments.length,
    issues: [...issues, ...utilisation],
    writeLockMs,
    projectEnd,
  };
}

/**
 * `J06` — ai đang rảnh, tính trên pool TOÀN CỤC (§8.3).
 *
 * Cửa sổ chạy từ MỐC CHUẨN tới hết dự án (PM chốt 2026-09-13). Đo cả span thì người tham
 * gia ở giai đoạn cuối luôn hiện ra là rảnh dù chưa tới lượt; câu hỏi PM đặt là "ai đang
 * rảnh", ở thì hiện tại.
 *
 * Tách khỏi `scheduleProject` vì nó là rule duy nhất mà câu trả lời phụ thuộc vào dự án
 * KHÁC — nên nó cũng là rule duy nhất phải chờ cả lượt chạy xong mới đếm được.
 */
export function poolUtilisationIssues(
  db: Db,
  pending: DeferredPoolAudit,
  engine: CalendarEngine,
): ScheduleIssue[] {
  if (pending.windowEnd === null) return [];
  return checkResourceUtilisation({
    // Chỉ người CÓ làm dự án này. Đo toàn cục rồi báo ở mọi dự án thì cùng một phát hiện
    // lặp lại khắp nơi.
    resourceIds: pending.resourceIds,
    // Nhưng ĐẾM thì đếm toàn cục — đó là cả điểm của rule.
    assignments: scheduleRepo.loadAssignmentsInWindow(db, pending.windowStart, pending.windowEnd),
    windowStart: pending.windowStart,
    windowEnd: pending.windowEnd,
    capacityOn: (resourceId, date) => engine.capacityOn(resourceId, date),
  }).map((i) => ({
    code: i.code,
    severity: i.severity,
    message: i.message,
    ...(typeof i.detail?.['taskUid'] === 'string' ? { taskUid: i.detail['taskUid'] } : {}),
  }));
}

// ── §7.12 — lập lịch xuyên dự án ────────────────────────────────────────────

export interface ScheduleAllOptions {
  readonly runId: string;
  readonly now: string;
  readonly windowDays?: number;
}

export interface ScheduleAllResult {
  /** Theo đúng thứ tự đã chạy: priority tăng dần, trùng thì code tăng dần. */
  readonly order: readonly string[];
  readonly perProject: ReadonlyMap<string, ScheduleResult>;
}

/**
 * "Recalculate all" — chạy hết mọi dự án theo thứ tự ưu tiên (§7.12).
 *
 * Dự án ưu tiên 1 xếp trên lịch trống; assignment của nó ghi vào pool chung; dự án tiếp
 * theo coi phần đó là đã chiếm. Dồn qua DB chứ không qua bộ nhớ chung: mỗi lượt
 * `scheduleProject` đọc lại assignment của các dự án đã xếp xong, nên trạng thái trung
 * gian luôn nhất quán kể cả khi một dự án ở giữa bị chặn vì Critical.
 *
 * ## "Lịch trống" phải được nói rõ là trống với những ai
 *
 * Bản trước truyền `respectOtherProjects: true` cho mọi dự án với lập luận "dự án chưa
 * xếp thì chưa có assignment nào trong DB". Câu đó chỉ đúng ở lần chạy đầu tiên trong
 * đời một DB. Từ lần thứ hai trở đi, dự án ưu tiên 1 phải né lịch CŨ của dự án ưu tiên 2
 * — lịch mà chính lượt chạy này sắp ghi đè — nên:
 *
 * - thứ tự ưu tiên đảo ngược trên thực tế (đo trên `data/dev.db`: dự án `priority 1` sinh
 *   10 issue `J14` đổ lỗi cho dự án `priority 2`);
 * - kết quả không hội tụ: mỗi lượt lấy output lượt trước làm input, chạy ba lượt ra ba
 *   lịch khác nhau, vi phạm M2.
 *
 * Cách sửa: mỗi lượt chỉ tôn trọng dự án đã xếp xong và dự án NGOÀI lượt chạy (`onhold`,
 * `closed` — họ giữ chỗ thật). Không xoá sạch bảng `assignment` trước vòng lặp, vì
 * `loadRunningAssignees` đọc đúng bảng đó để giữ người cho task `in_progress` (§7.12).
 *
 * Lệnh này đụng lịch của MỌI dự án, nên §10.6 chỉ cho admin chạy.
 */
export function scheduleAllProjects(db: Db, options: ScheduleAllOptions): ScheduleAllResult {
  const projects = scheduleRepo.loadSchedulableProjects(db);
  const perProject = new Map<string, ScheduleResult>();
  const order: string[] = [];

  try {
    for (let i = 0; i < projects.length; i += 1) {
      const project = projects[i];
      if (project === undefined) continue;
      const result = scheduleProject(db, {
        projectId: project.id,
        runId: options.runId,
        now: options.now,
        ...(options.windowDays === undefined ? {} : { windowDays: options.windowDays }),
        respectOtherProjects: true,
        // Chưa tới lượt — lịch hiện có của họ là output lượt trước, không phải chỗ đã chiếm.
        pendingProjects: projects.slice(i + 1).map((p) => p.id),
        poolAudit: 'defer',
      });
      perProject.set(project.id, result);
      order.push(project.id);
    }
  } finally {
    // `finally` chứ không phải sau vòng lặp: một dự án ở giữa bị chặn vì Critical sẽ ném
    // ra ngoài, và issue của những dự án đã xếp xong phải ở lại DB thì PM mới đọc được vì
    // sao. Lúc đó pool mới ổn định một phần — vẫn đúng hơn là không ghi gì.
    const engine = createCalendarEngine(loadCalendarSnapshot(db));
    for (const [projectId, result] of perProject) {
      const pending = result.deferred;
      if (pending === undefined) continue;
      const utilisation = poolUtilisationIssues(db, pending, engine);
      recordValidationRun(db, {
        runId: pending.runId,
        projectId: pending.projectId,
        detectedAt: pending.detectedAt,
        source: 'schedule',
        issues: [
          ...pending.recorded,
          ...utilisation.map((i) => ({
            severity: i.severity,
            code: i.code,
            message: i.message,
            ...(i.taskUid === undefined ? {} : { taskUid: i.taskUid }),
          })),
        ],
      });
      // Người gọi đọc `issues` để đếm — nó phải gồm cả `J06` như đường một dự án.
      perProject.set(projectId, {
        report: result.report,
        scheduledCount: result.scheduledCount,
        assignedCount: result.assignedCount,
        issues: [...result.issues, ...utilisation],
        writeLockMs: result.writeLockMs,
        projectEnd: result.projectEnd,
      });
    }
  }

  return { order, perProject };
}
