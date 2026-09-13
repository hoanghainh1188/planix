/**
 * Rollup lên summary và chuẩn hoá micro task — SPEC.md §7.7, §7.9.
 *
 * Summary **không có dữ liệu riêng**: mọi thứ tính từ con, đệ quy từ dưới lên (§7.7).
 * Hàm thuần (CLAUDE.md §3).
 */

import type { ProgressStatus, TaskKind } from './validation-types.js';

export interface RollupTask {
  readonly uid: string;
  readonly parentUid: string | null;
  readonly kind: TaskKind;
  readonly effortMd: number | null;
  readonly status: ProgressStatus;
  readonly percent: number;
  /** Ngày từ `schedule`; null khi task chưa được xếp lịch. */
  readonly planStart: string | null;
  readonly planEnd: string | null;
}

export interface RollupRow {
  readonly status: ProgressStatus;
  /** Không làm tròn — làm tròn chỉ ở bước hiển thị (§7.7). */
  readonly percent: number;
  /** Bản đã làm tròn 1 chữ số thập phân, dùng để hiện ra và xuất Excel. */
  readonly percentDisplay: number;
  readonly effortRollup: number;
  /** Summary: min/max của con (§7.7). Lá: ngày của chính nó. */
  readonly planStart: string | null;
  readonly planEnd: string | null;
}

export interface RollupIssue {
  readonly code: string;
  readonly severity: 'Critical' | 'Major' | 'Minor';
  readonly message: string;
  readonly taskUid: string;
}

export interface RollupResult {
  readonly rows: ReadonlyMap<string, RollupRow>;
  readonly issues: readonly RollupIssue[];
  get(uid: string): RollupRow | undefined;
}

/**
 * Status của summary, xét CON TRỰC TIẾP, khớp bậc nào là dừng (§7.7).
 *
 * Bậc 3 (blocked) đứng TRÊN bậc 4 (in_progress) là có chủ ý: task bị chặn phải nổi lên
 * tận gốc cây, nếu không PM sẽ không thấy nó trong bảng tổng.
 */
function rollupStatus(children: readonly RollupRow[] | readonly ProgressStatus[]): ProgressStatus {
  const statuses = (children as readonly unknown[]).map((c) =>
    typeof c === 'string' ? c : (c as RollupRow).status,
  ) as ProgressStatus[];

  if (statuses.length === 0) return 'not_started';
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';

  const live = statuses.filter((s) => s !== 'cancelled');
  if (live.length > 0 && live.every((s) => s === 'done')) return 'done';
  if (live.some((s) => s === 'blocked')) return 'blocked';
  if (live.some((s) => s === 'in_progress' || s === 'done')) return 'in_progress';
  return 'not_started';
}

export function rollupTree(tasks: readonly RollupTask[]): RollupResult {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const children = new Map<string, RollupTask[]>();
  for (const t of tasks) {
    if (t.parentUid === null) continue;
    const list = children.get(t.parentUid);
    if (list === undefined) children.set(t.parentUid, [t]);
    else list.push(t);
  }
  // Duyệt con theo uid đã sắp để kết quả không phụ thuộc thứ tự mảng vào (N2).
  for (const list of children.values()) {
    list.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  }

  const rows = new Map<string, RollupRow>();
  const issues: RollupIssue[] = [];

  /** Hậu thứ tự: con xong trước, cha tính sau. Stack tường minh, không đệ quy. */
  const order: string[] = [];
  const roots = tasks.filter((t) => t.parentUid === null || !byUid.has(t.parentUid));
  const stack = [...roots].sort((a, b) => (a.uid < b.uid ? -1 : 1)).map((t) => t.uid);
  const seen = new Set<string>();
  while (stack.length > 0) {
    const uid = stack.pop();
    if (uid === undefined || seen.has(uid)) continue;
    seen.add(uid);
    order.push(uid);
    for (const c of children.get(uid) ?? []) stack.push(c.uid);
  }

  for (let i = order.length - 1; i >= 0; i--) {
    const uid = order[i];
    if (uid === undefined) continue;
    const task = byUid.get(uid);
    if (task === undefined) continue;

    const kids = children.get(uid) ?? [];

    if (kids.length === 0) {
      const effort = task.effortMd ?? 0;
      rows.set(uid, {
        status: task.status,
        percent: task.percent,
        percentDisplay: round1(task.percent),
        effortRollup: effort,
        planStart: task.planStart,
        planEnd: task.planEnd,
      });
      continue;
    }

    if (task.effortMd !== null && task.effortMd !== 0) {
      // §8.2 J02 — mâu thuẫn tổng vs chi tiết.
      issues.push({
        code: 'J02',
        severity: 'Major',
        message: `Summary ${uid} has effort_md; summary effort must roll up from children.`,
        taskUid: uid,
      });
    }

    const kidRows = kids
      .map((k) => ({ task: k, row: rows.get(k.uid) }))
      .filter((x): x is { task: RollupTask; row: RollupRow } => x.row !== undefined);

    const status = rollupStatus(kidRows.map((x) => x.row.status));

    // Chỉ con KHÔNG cancelled mới tham gia tính effort và percent (§7.7).
    const live = kidRows.filter((x) => x.row.status !== 'cancelled');
    const effortRollup = live.reduce((acc, x) => acc + x.row.effortRollup, 0);

    let percent: number;
    if (live.length === 0) {
      percent = 0;
    } else if (effortRollup === 0) {
      // Toàn bộ con có tổng MD = 0 (ví dụ chỉ toàn mốc thuần) → trung bình cộng (§7.7).
      percent = live.reduce((acc, x) => acc + x.row.percent, 0) / live.length;
    } else {
      percent = live.reduce((acc, x) => acc + x.row.effortRollup * x.row.percent, 0) / effortRollup;
    }

    // Ngày ISO so sánh theo chuỗi là đúng thứ tự thời gian, nên không cần parse.
    // Chỉ lấy con còn sống: task huỷ đã bị gỡ khỏi mạng lưới nên thường không có ngày,
    // nhưng một hàng cũ còn sót ngày thì không được phép kéo dài thanh của summary.
    let planStart: string | null = null;
    let planEnd: string | null = null;
    for (const { row } of live) {
      if (row.planStart !== null && (planStart === null || row.planStart < planStart)) {
        planStart = row.planStart;
      }
      if (row.planEnd !== null && (planEnd === null || row.planEnd > planEnd)) {
        planEnd = row.planEnd;
      }
    }

    rows.set(uid, {
      status,
      percent,
      percentDisplay: round1(percent),
      effortRollup,
      planStart,
      planEnd,
    });
  }

  return {
    rows,
    issues,
    get: (uid) => rows.get(uid),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ── §7.9 micro task ─────────────────────────────────────────────────────────

export function isMicroTask(
  task: { kind: TaskKind; effortMd: number | null },
  threshold: number,
): boolean {
  // Summary không có effort riêng nên không bao giờ là micro task.
  if (task.kind === 'summary') return false;
  return task.effortMd !== null && task.effortMd <= threshold;
}

export interface MicroTaskInput {
  readonly effortMd: number;
  readonly status: ProgressStatus;
  readonly percent: number;
}

export interface MicroTaskOutput {
  readonly percent: number;
  readonly remainingMd: number;
  readonly issue: RollupIssue | null;
}

/**
 * Chuẩn hoá micro task: `%` và `remaining_md` được SUY RA, không nhập tay (§7.9).
 *
 * Ở WBS mịn, tiến độ thực chất đo bằng đếm task xong. Cho phép nhập 37% trên một task
 * 0.25 MD là tạo ảo giác chính xác mà dữ liệu không có.
 */
export function normalizeMicroTask(input: MicroTaskInput): MicroTaskOutput {
  if (input.status === 'in_progress' || input.status === 'blocked') {
    throw new Error(
      `Micro task cannot have status "${input.status}"; only not_started, done or cancelled (§7.9).`,
    );
  }

  const done = input.status === 'done';
  const percent = done ? 100 : 0;
  const remainingMd = done ? 0 : input.effortMd;

  const issue =
    input.percent === percent
      ? null
      : ({
          code: 'N09',
          severity: 'Minor',
          message: `Micro task percent ${input.percent} normalised to ${percent}.`,
          taskUid: '',
        } satisfies RollupIssue);

  return { percent, remainingMd, issue };
}
