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
import { createCalendarEngine } from '../domain/calendar.js';
import { runCpm, type CpmTask } from '../domain/cpm.js';
import { reforecast, type ReforecastTask } from '../domain/reforecast.js';
import { runSgs, type SgsResource, type SgsTask, type SgsScheduleRow } from '../domain/sgs.js';
import { validate } from '../domain/validator.js';
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
}

export interface ScheduleIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly taskUid?: string;
}

export interface ScheduleResult {
  readonly report: ValidationReport;
  readonly scheduledCount: number;
  readonly assignedCount: number;
  readonly issues: readonly ScheduleIssue[];
  /** §3.1 đặt ngưỡng 200 ms cho write lock. */
  readonly writeLockMs: number;
  readonly projectEnd: DateOnly | null;
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
  const report = validate({
    runId: options.runId,
    projectId: settings.id,
    tasks: importRepo.loadTasks(db, settings.id),
    dependencies: importRepo.loadDependencies(db, settings.id),
    resources: importRepo.loadResources(db),
    resourceRoles: importRepo.loadResourceRoles(db),
    progress: importRepo.loadProgress(db, settings.id),
    dependencyMaxLevel: settings.dependencyMaxLevel,
  });
  if (!report.passed) throw new ScheduleBlockedError(report);

  const issues: ScheduleIssue[] = [];
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
      pinnedResource: f.pinnedResource,
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

  const sgs = runSgs({
    clusters: clusters.map((c) => ({
      uid: c.uid,
      leafUids: [
        ...c.leafUids.filter((uid) => sgsUids.has(uid)),
        ...(extraByCluster.get(c.uid) ?? []),
      ],
    })),
    tasks: sgsTasks,
    edges: leafEdges.filter((e) => sgsUids.has(e.predUid) && sgsUids.has(e.succUid)),
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
    });
  }

  // Task `done` giữ nguyên ngày thật, ghép vào cùng bảng kết quả (§7.11).
  const schedule = new Map<string, SgsScheduleRow>();
  for (const [uid, row] of sgs.schedule) {
    // Nút gộp là cấu trúc nội bộ, không có dòng `task` tương ứng nên không ghi ra DB.
    if (joinUids.has(uid)) continue;
    schedule.set(uid, row);
  }
  for (const [uid, row] of forecast.rows) {
    if (row.mode !== 'fixed') continue;
    if (row.fixedStart === null || row.fixedEnd === null) continue;
    schedule.set(uid, {
      startDate: row.fixedStart,
      endDate: row.fixedEnd,
      durationDays: engine.workingDaysBetween(lagCalendarId, row.fixedStart, row.fixedEnd) + 1,
      delayReason: null,
      blockingRef: null,
    });
  }

  // ── Pha C — ghi kết quả trong một transaction ngắn (§3.1, §4.3) ───────────
  const { writeLockMs } = scheduleRepo.writeScheduleResults(db, {
    projectId: settings.id,
    computedAt: options.now,
    cpm,
    schedule,
    assignments: sgs.assignments,
  });

  let projectEnd: DateOnly | null = null;
  for (const row of schedule.values()) {
    if (projectEnd === null || row.endDate > projectEnd) projectEnd = row.endDate;
  }

  return {
    report,
    scheduledCount: schedule.size,
    assignedCount: sgs.assignments.length,
    issues,
    writeLockMs,
    projectEnd,
  };
}
