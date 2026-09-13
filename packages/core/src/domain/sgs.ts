/**
 * Serial SGS theo cụm — SPEC.md §7.3, §7.5, §7.6.
 *
 * Pha B của §7.1: pha A giả định nguồn lực vô hạn, pha B áp ràng buộc nhân sự thật.
 * Chênh lệch giữa hai pha chính là chi phí do thiếu người (§7.2).
 *
 * N4: engine KHÔNG tự phá ràng buộc. Pin người gây quá tải thì sinh `J01` chứ không
 * đổi người; không đủ người đảm nhiệm role thì ném lỗi chứ không tự hạ yêu cầu.
 */

import type { CalendarEngine } from './calendar.js';
import { addDays, type DateOnly } from './date-only.js';
import type { DepEdge } from './dependency.js';
import { ResourcePool } from './resource-pool.js';
import {
  compareByPriorityKey,
  compareByResourceKey,
  type PriorityCandidate,
  type ResourceCandidate,
} from './tie-break.js';
import type { ConstraintType } from './validation-types.js';

export interface SgsTask {
  readonly uid: string;
  readonly wbsCode: string;
  readonly clusterUid: string;
  readonly kind: 'work' | 'milestone';
  readonly priority: number;
  readonly role: string | null;
  readonly effortMd: number;
  readonly pinnedResource: string | null;
  readonly constraintType: ConstraintType | null;
  readonly constraintDate: DateOnly | null;
  /** Từ pha A — PRIORITY_KEY bậc 2 và 3 (§7.4). */
  readonly ls: DateOnly;
  readonly totalFloat: number;
}

export interface SgsResource {
  readonly id: string;
  /** role → proficiency. Rỗng nghĩa là không đảm nhiệm được gì. */
  readonly roles: Readonly<Record<string, number>>;
  readonly maxParallel: number;
}

export interface SgsCluster {
  readonly uid: string;
  readonly leafUids: readonly string[];
}

export interface SgsAssignment {
  readonly taskUid: string;
  readonly resourceId: string;
  readonly allocation: number;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  readonly isPinned: boolean;
}

export type DelayReason = 'dependency' | 'resource' | 'cross_project' | 'calendar' | 'constraint';

export interface SgsScheduleRow {
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly durationDays: number;
  readonly delayReason: DelayReason | null;
  readonly blockingRef: string | null;
}

export interface SgsIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly taskUid?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface SgsInput {
  /** Cụm đã topo sort ở mức summary (§6.2). Xếp xong cụm này mới sang cụm kế. */
  readonly clusters: readonly SgsCluster[];
  readonly tasks: readonly SgsTask[];
  readonly edges: readonly DepEdge[];
  readonly resources: readonly SgsResource[];
  readonly engine: CalendarEngine;
  /** Lịch B của `project.default_location` — lag luôn cộng theo lịch này (§6.1). */
  readonly calendarId: string;
  readonly projectStart: DateOnly;
  readonly statusDate: DateOnly;
  readonly minAllocation: number;
  readonly defaultMaxParallel: number;
  readonly windowDays: number;
}

export interface SgsResult {
  readonly assignments: readonly SgsAssignment[];
  readonly schedule: ReadonlyMap<string, SgsScheduleRow>;
  readonly issues: readonly SgsIssue[];
}

export class SchedulingDeadlockError extends Error {
  readonly clusterUid: string;
  constructor(clusterUid: string, remaining: readonly string[]) {
    super(`Scheduling deadlock in cluster ${clusterUid}; unresolved: ${remaining.join(', ')}`);
    this.name = 'SchedulingDeadlockError';
    this.clusterUid = clusterUid;
  }
}

export class NoEligibleResourceError extends Error {
  readonly taskUid: string;
  constructor(taskUid: string, role: string | null) {
    super(`No eligible resource for task ${taskUid} with role ${role ?? '(none)'}`);
    this.name = 'NoEligibleResourceError';
    this.taskUid = taskUid;
  }
}

/**
 * Có người đảm nhiệm được role, nhưng TẤT CẢ đều kín lịch tới hết cửa sổ.
 *
 * Tách khỏi `NoEligibleResourceError` vì hai tình huống này đòi hai cách xử lý khác
 * hẳn: một bên là thiếu người có kỹ năng (tuyển, đào tạo, đổi role), bên kia là thiếu
 * giờ (thêm người, giãn deadline, cắt scope). Gộp chung sẽ khiến PM đọc sai vấn đề.
 */
export class ResourceWindowExhaustedError extends Error {
  readonly taskUid: string;
  readonly role: string | null;
  readonly candidateIds: readonly string[];
  constructor(taskUid: string, role: string | null, candidateIds: readonly string[]) {
    super(
      `Task ${taskUid} (role ${role ?? '(none)'}) cannot be placed: all ${candidateIds.length} ` +
        `eligible resource(s) are fully booked through the scheduling window.`,
    );
    this.name = 'ResourceWindowExhaustedError';
    this.taskUid = taskUid;
    this.role = role;
    this.candidateIds = [...candidateIds];
  }
}

/**
 * Các mức allocation thử theo §7.5: full-time trước, rồi hạ dần theo bước 0.25.
 *
 * Trần KHÔNG phải lúc nào cũng 1.0 mà là nhu cầu thật của task, làm tròn lên bội 0.25.
 * Gán 1.0 cho một task 0.25 MD sẽ chiếm trọn một ngày của một người để làm một phần tư
 * ngày việc — §7.5 ràng buộc theo TỔNG allocation trong ngày và `max_parallel`, tức bốn
 * task 0.25 MD phải chia nhau được một ngày. Không chặn trần thì ở WBS mịn (§1.5 chốt độ
 * mịn 0.25 MD) năng lực bị đốt gấp nhiều lần lượng việc thật.
 */
function allocationLadder(minAllocation: number, effortMd: number): number[] {
  const needed = Math.min(1, Math.max(minAllocation, Math.ceil(effortMd * 4) / 4));
  const out: number[] = [];
  for (let a = needed; a >= minAllocation - 1e-9; a -= 0.25) out.push(Math.round(a * 100) / 100);
  return out.length === 0 ? [minAllocation] : out;
}

export function runSgs(input: SgsInput): SgsResult {
  const {
    clusters,
    tasks,
    edges,
    resources,
    engine,
    calendarId,
    projectStart,
    statusDate,
    minAllocation,
    defaultMaxParallel,
    windowDays,
  } = input;

  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const windowStart = projectStart < statusDate ? projectStart : statusDate;
  const pool = new ResourcePool(
    engine,
    resources.map((r) => r.id),
    windowStart,
    windowDays,
  );

  const predecessors = new Map<string, DepEdge[]>();
  for (const e of edges) {
    const list = predecessors.get(e.succUid);
    if (list === undefined) predecessors.set(e.succUid, [e]);
    else list.push(e);
  }

  const assignments: SgsAssignment[] = [];
  const schedule = new Map<string, SgsScheduleRow>();
  const issues: SgsIssue[] = [];

  /**
   * Đặt task vào lịch của một người ở một mức allocation.
   *
   * Ngày mà người đó bận hoặc nghỉ thì đóng góp 0 và task kéo dài thêm — đúng ngữ nghĩa
   * "task chạy tới khi xong việc", và xử lý cuối tuần, lễ, xung đột bằng cùng một cơ chế.
   */
  function place(
    resourceId: string,
    earliest: DateOnly,
    effort: number,
    allocation: number,
    maxParallel: number,
  ): { start: DateOnly; end: DateOnly } | null {
    const start = pool.firstDayWithRoom(resourceId, earliest, allocation, maxParallel);
    if (start === null) return null;

    let remainingEffort = effort;
    let cursor = start;
    for (let i = 0; i < windowDays; i++) {
      const room = pool.remaining(resourceId, cursor);
      const running = pool.parallelOn(resourceId, cursor);
      if (room >= allocation && running < maxParallel) {
        remainingEffort -= allocation;
        if (remainingEffort <= 1e-9) return { start, end: cursor };
      }
      cursor = addDays(cursor, 1);
    }
    return null;
  }

  for (const cluster of clusters) {
    const leaves = cluster.leafUids
      .map((uid) => byUid.get(uid))
      .filter((t): t is SgsTask => t !== undefined);

    const pending = new Set(leaves.map((t) => t.uid));
    const scheduledLocal = new Set<string>();

    while (pending.size > 0) {
      // Task sẵn sàng: mọi predecessor (trong cụm) đã xếp xong.
      const ready = leaves.filter((t) => {
        if (!pending.has(t.uid)) return false;
        return (predecessors.get(t.uid) ?? []).every(
          (e) => !pending.has(e.predUid) || scheduledLocal.has(e.predUid),
        );
      });

      if (ready.length === 0) throw new SchedulingDeadlockError(cluster.uid, [...pending].sort());

      const candidates: PriorityCandidate[] = ready.map((t) => ({
        uid: t.uid,
        priority: t.priority,
        ls: t.ls,
        totalFloat: t.totalFloat,
        wbsCode: t.wbsCode,
      }));
      candidates.sort(compareByPriorityKey);

      const chosenUid = candidates[0]?.uid;
      if (chosenUid === undefined) break;
      const t = byUid.get(chosenUid);
      if (t === undefined) break;

      // ── Cận dưới của start ────────────────────────────────────────────────
      let earliest = statusDate > projectStart ? statusDate : projectStart;
      let reason: DelayReason | null = null;
      let blockingRef: string | null = null;

      for (const e of predecessors.get(t.uid) ?? []) {
        const pred = schedule.get(e.predUid);
        if (pred === undefined) continue;

        // Lag cộng theo LỊCH B của default_location (§6.1), không phải ngày lịch thuần.
        //
        // SS lấy mốc là ngày bắt đầu của predecessor; các loại còn lại lấy mốc là ngày
        // làm việc kế tiếp sau khi predecessor xong — cùng quy ước ngày của pha A.
        const candidate =
          e.type === 'SS'
            ? engine.addWorkingDays(calendarId, pred.startDate, e.lagDays)
            : engine.addWorkingDays(calendarId, pred.endDate, e.lagDays + 1);

        if (candidate > earliest) {
          earliest = candidate;
          reason = 'dependency';
          blockingRef = e.predUid;
        }
      }

      if (t.constraintDate !== null) {
        if (
          (t.constraintType === 'SNET' && t.constraintDate > earliest) ||
          t.constraintType === 'MSO'
        ) {
          earliest = t.constraintDate;
          reason = 'constraint';
          blockingRef = null;
        }
      }

      // ── Mốc thuần: không gán người, duration 0 (§7.10) ────────────────────
      if (t.kind === 'milestone' && t.effortMd <= 0) {
        const day = earliest;
        schedule.set(t.uid, {
          startDate: day,
          endDate: day,
          durationDays: 0,
          delayReason: reason,
          blockingRef,
        });
        pending.delete(t.uid);
        scheduledLocal.add(t.uid);
        continue;
      }

      // ── Chọn người ────────────────────────────────────────────────────────
      let eligible: SgsResource[];
      if (t.pinnedResource !== null) {
        const pinned = resourceById.get(t.pinnedResource);
        if (pinned === undefined) throw new NoEligibleResourceError(t.uid, t.role);
        // N4: pin được tôn trọng TUYỆT ĐỐI, kể cả khi lịch xấu đi hoặc người đó không
        // có role. Xung đột thì báo J01, không tự đổi người (§4.3).
        if (t.role !== null && pinned.roles[t.role] === undefined) {
          issues.push({
            code: 'J01',
            severity: 'Major',
            message: `Task ${t.uid} is pinned to ${pinned.id}, who does not hold role ${t.role}.`,
            taskUid: t.uid,
            detail: { resourceId: pinned.id, role: t.role },
          });
        }
        eligible = [pinned];
      } else {
        eligible = resources.filter((r) => t.role !== null && r.roles[t.role] !== undefined);
        if (eligible.length === 0) throw new NoEligibleResourceError(t.uid, t.role);
      }

      // Mỗi người cho một phương án: mức allocation CAO NHẤT đặt được (§7.5 "full-time
      // trước", vì chia mỏng làm tăng context switching mà engine không mô hình hoá được).
      const options: Array<{
        res: SgsResource;
        allocation: number;
        start: DateOnly;
        end: DateOnly;
        key: ResourceCandidate;
      }> = [];

      for (const r of eligible) {
        const maxParallel = r.maxParallel > 0 ? r.maxParallel : defaultMaxParallel;
        for (const allocation of allocationLadder(minAllocation, t.effortMd)) {
          const placed = place(r.id, earliest, t.effortMd, allocation, maxParallel);
          if (placed === null) continue;
          options.push({
            res: r,
            allocation,
            start: placed.start,
            end: placed.end,
            key: {
              resourceId: r.id,
              expectedFinish: placed.end,
              proficiency: t.role === null ? 1 : (r.roles[t.role] ?? 1),
              assignedMd: pool.assignedMd(r.id),
            },
          });
          break; // thang đi từ cao xuống; mức đầu tiên đặt được là cao nhất khả thi
        }
      }

      if (options.length === 0) {
        if (t.pinnedResource === null) {
          // `eligible` không rỗng ở đây (đã kiểm ở trên), nên vấn đề là hết chỗ chứ
          // không phải thiếu người có role.
          throw new ResourceWindowExhaustedError(t.uid, t.role, eligible.map((r) => r.id).sort());
        }

        // §4.3: pin phải được tôn trọng TUYỆT ĐỐI, kể cả khi lịch xấu đi. Không còn chỗ
        // thì vẫn ép gán và báo J01 — engine không tự đổi người (N4). PM quyết.
        const pinned = resourceById.get(t.pinnedResource);
        if (pinned === undefined) throw new NoEligibleResourceError(t.uid, t.role);

        const forcedStart = engine.nextWorkingDay(calendarId, earliest);
        const forcedEnd = engine.addWorkingDays(
          calendarId,
          forcedStart,
          Math.max(0, Math.ceil(t.effortMd) - 1),
        );
        issues.push({
          code: 'J01',
          severity: 'Major',
          message: `Task ${t.uid} is pinned to ${pinned.id}, who has no free capacity; forced assignment overallocates.`,
          taskUid: t.uid,
          detail: { resourceId: pinned.id, from: forcedStart, to: forcedEnd },
        });
        options.push({
          res: pinned,
          allocation: 1,
          start: forcedStart,
          end: forcedEnd,
          key: {
            resourceId: pinned.id,
            expectedFinish: forcedEnd,
            proficiency: t.role === null ? 1 : (pinned.roles[t.role] ?? 1),
            assignedMd: pool.assignedMd(pinned.id),
          },
        });
      }

      // RESOURCE_KEY đủ 4 bậc §7.4. Chỉ so ngày kết thúc là không đủ: hai người cùng
      // ngày xong thì kết quả sẽ phụ thuộc thứ tự mảng `resources`, tức phụ thuộc thứ
      // tự dòng DB trả về — M2 sụp.
      options.sort((a, b) => compareByResourceKey(a.key, b.key));
      const best = options[0];
      if (best === undefined) throw new NoEligibleResourceError(t.uid, t.role);

      // Nếu bị đẩy muộn hơn cận dưới thì lý do là chờ người (§7.6).
      if (best.start > earliest && reason === null) {
        reason = 'resource';
        blockingRef = best.res.id;
      }

      pool.reserve(best.res.id, best.start, best.end, best.allocation);
      assignments.push({
        taskUid: t.uid,
        resourceId: best.res.id,
        allocation: best.allocation,
        fromDate: best.start,
        toDate: best.end,
        isPinned: t.pinnedResource !== null,
      });
      schedule.set(t.uid, {
        startDate: best.start,
        endDate: best.end,
        // [start, end] bao gồm cả ngày cuối, nên đếm tới end + 1 ngày lịch.
        durationDays: engine.workingDaysBetween(calendarId, best.start, addDays(best.end, 1)),
        delayReason: reason,
        blockingRef,
      });
      pending.delete(t.uid);
      scheduledLocal.add(t.uid);
    }
  }

  // Thứ tự assignment không được phụ thuộc thứ tự duyệt (M2).
  assignments.sort((a, b) => (a.taskUid < b.taskUid ? -1 : a.taskUid > b.taskUid ? 1 : 0));

  return { assignments, schedule, issues };
}
