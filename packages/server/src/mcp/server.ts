/**
 * Lớp MCP — SPEC.md §12.
 *
 * §12.4 chốt bốn điều, và chúng định hình toàn bộ file này:
 *
 *   - *"Tool đọc KHÔNG trả về text đã diễn giải. Chỉ JSON có cấu trúc."* Nên mọi tool ở
 *     đây trả `structuredContent`; phần `content` chỉ là bản JSON in ra nguyên văn, dành
 *     cho client chưa đọc được `structuredContent`. Không có câu văn nào do tool tự đặt.
 *   - Mọi tool ghi chạy trong transaction, lỗi thì rollback.
 *   - Sau mỗi tool ghi, kèm `ValidationReport`.
 *   - Endpoint dùng bearer token riêng, không dùng session cookie.
 *
 * PR này cài phần ĐỌC (§12.1). Tool ghi (§12.2) và tool chạy (§12.3) là slice sau;
 * `wbs_what_if` thuộc P14 theo §14.1, không nằm trong P13.
 *
 * Quyền: token trỏ tới một `app_user`, nên mọi tool đi qua đúng bảng §10.6 mà web đang
 * dùng. Không có đường tắt nào cho AI — đó là điểm của nguyên tắc N1.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as authRepo from '@planix/core/db/repo/auth-repo.js';
import * as importRepo from '@planix/core/db/repo/import-repo.js';
import * as mcpRepo from '@planix/core/db/repo/mcp-repo.js';
import { projectOfTask, loadTaskDependencies } from '@planix/core/db/repo/read-repo.js';
import { validate } from '@planix/core/domain/validator.js';
import { assertCan, ForbiddenError } from '../auth/permissions.js';
import { errorResult, jsonResult, type McpContext, type McpToolResult } from './result.js';
import { registerWriteTools } from './write-tools.js';
import { registerRunTools } from './run-tools.js';

export type { McpContext } from './result.js';

/**
 * Chặn ở biên, đúng bảng §10.6.
 *
 * §10.6 nói "kiểm tra quyền ở server, không chỉ ẩn nút trên UI" — với MCP thì không có
 * nút nào để ẩn, nên đây là lớp duy nhất. Vai đọc lại mỗi lời gọi, không cache theo
 * token: admin thu hồi quyền phải có hiệu lực ngay, không đợi token hết hạn.
 */
function ensureCanView(ctx: McpContext, projectId: string): void {
  const assignment = authRepo.findProjectRole(ctx.db, ctx.principal.userId, projectId);
  assertCan('view_assigned_project', {
    isAdmin: ctx.principal.isAdmin,
    projectRole: assignment?.role ?? null,
  });
}

/**
 * Bọc một tool: đổi `ForbiddenError` thành kết quả lỗi thay vì để nó thoát ra ngoài.
 *
 * Để nó thoát thì SDK biến thành lỗi JSON-RPC nội bộ, và client đọc ra "server hỏng" chứ
 * không phải "bạn không có quyền" — hai thứ cần phản ứng khác hẳn nhau.
 */
function guard(run: () => McpToolResult): McpToolResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof ForbiddenError) return errorResult(`Not allowed: ${error.message}`);
    throw error;
  }
}

/** Đổi mã dự án (`UTG`) hoặc id sang id. AI đọc mã dễ hơn id, nên nhận cả hai. */
function resolveProjectId(ctx: McpContext, projectRef: string): string | undefined {
  const byCode = importRepo.findProjectByCode(ctx.db, projectRef);
  if (byCode !== undefined) return byCode.id;
  const byId = ctx.db.prepare('SELECT id FROM project WHERE id = ?').get(projectRef) as
    { id: string } | undefined;
  return byId?.id;
}

/**
 * Trần số dòng một tool trả về.
 *
 * Đo trên fixture 6.000 task: `wbs_get_tree` không giới hạn sinh ra 3,9 MB JSON —
 * khoảng một triệu token. Không model nào đọc nổi, và nó đã đi qua dây trước khi ai kịp
 * nhận ra. §12.1 gọi output của tool này là "cây RÚT GỌN", nên trả cả cây vốn đã không
 * phải ý định ban đầu.
 *
 * Trần cứng chứ không chỉ mặc định: một `limit` do client tự đặt cũng không được vượt.
 * Người gọi là AI, và nó sẽ xin nhiều hơn nếu được phép.
 */
/**
 * Dòng "rút gọn" cho `wbs_get_tree`.
 *
 * §12.1 phân biệt ba mức và đây là mức hẹp nhất: `wbs_get_tree` → "cây RÚT GỌN",
 * `wbs_list_tasks` → "task + schedule", `wbs_get_task` → "task ĐẦY ĐỦ". Trả cả 28 cột ở
 * cả ba là bỏ qua sự phân biệt đó — và trên 6.000 task nó là khác biệt giữa 361 KB và
 * 96 KB cho cùng một câu hỏi về hình dạng cây.
 *
 * Giữ lại đúng thứ trả lời được "cây trông thế nào và mỗi nhánh nặng bao nhiêu". Ai cần
 * `phase`, `module`, `pic` thì gọi `wbs_list_tasks`; cần hết thì `wbs_get_task`.
 */
function slimRow(r: mcpRepo.McpTaskRow): Record<string, unknown> {
  return {
    uid: r.uid,
    wbsCode: r.wbsCode,
    depth: r.depth,
    parentUid: r.parentUid,
    name: r.name,
    kind: r.kind,
    effortMd: r.effortMd,
    status: r.status,
    percent: r.percent,
    startDate: r.startDate,
    endDate: r.endDate,
  };
}

const MAX_ROWS = 500;
const HARD_MAX_ROWS = 2000;

/**
 * Cắt trang và NÓI RA là đã cắt.
 *
 * `truncated` phải nằm trong dữ liệu, không phải trong một câu văn — §12.4 cấm text diễn
 * giải. Thiếu cờ này thì 500 dòng đầu của một cây 6.000 dòng trông y hệt một cây 500
 * dòng đầy đủ, và mọi kết luận sau đó ("dự án chỉ có ngần này việc") đều sai mà không có
 * dấu hiệu nào.
 */
function page<T>(
  rows: readonly T[],
  limit: number | undefined,
  offset: number | undefined,
): { total: number; offset: number; returned: number; truncated: boolean; tasks: T[] } {
  const from = offset ?? 0;
  const take = Math.min(limit ?? MAX_ROWS, HARD_MAX_ROWS);
  const tasks = rows.slice(from, from + take);
  return {
    total: rows.length,
    offset: from,
    returned: tasks.length,
    truncated: from + tasks.length < rows.length,
    tasks,
  };
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'planix', version: '0.1.0' });

  /** Mẫu chung của tool cần một dự án: đổi ref → id, kiểm quyền, rồi mới chạm dữ liệu. */
  const inProject = (projectRef: string, run: (projectId: string) => McpToolResult) =>
    guard(() => {
      const projectId = resolveProjectId(ctx, projectRef);
      if (projectId === undefined) return errorResult(`No project ${projectRef}.`);
      ensureCanView(ctx, projectId);
      return run(projectId);
    });

  /** Cùng mẫu, nhưng điểm vào là một task: dự án suy ra từ task rồi mới kiểm quyền. */
  const onTask = (uid: string, run: (projectId: string) => McpToolResult) =>
    guard(() => {
      const projectId = projectOfTask(ctx.db, uid);
      if (projectId === undefined) return errorResult(`No task ${uid}.`);
      ensureCanView(ctx, projectId);
      return run(projectId);
    });

  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

  // ── §12.1 — tool đọc ──────────────────────────────────────────────────────

  server.registerTool(
    'wbs_list_projects',
    {
      title: 'List projects',
      description:
        'Projects this token can see: id, code, name, priority, status, status date and the role held on each. Start here to get a project id for the other tools.',
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      jsonResult(authRepo.listUserProjects(ctx.db, ctx.principal.userId, ctx.principal.isAdmin)),
  );

  server.registerTool(
    'wbs_get_tree',
    {
      title: 'Get the WBS tree',
      description:
        'The shape of the task tree: code, name, kind, effort, status and dates per node. Optionally rooted at one task and cut off at a depth. For phase/module/assignee use wbs_list_tasks; for everything about one task use wbs_get_task. Paged: returns at most 500 rows by default and sets truncated=true when more remain — narrow with root_uid or max_depth rather than paging through a large tree.',
      inputSchema: {
        project: z.string().min(1).describe('Project id or code, from wbs_list_projects'),
        root_uid: z.string().min(1).optional().describe('Only this task and its descendants'),
        max_depth: z.number().int().min(1).max(20).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe('Rows to return, default 500, hard cap 2000'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    ({ project, root_uid, max_depth, limit, offset }) =>
      inProject(project, (projectId) => {
        const rows = mcpRepo.loadMcpTasks(ctx.db, projectId);

        // Cắt theo `root_uid` bằng cách bám chuỗi cha, KHÔNG bằng so tiền tố `wbs_code`:
        // mã đổi sau mỗi lần renumber (§4.3), còn quan hệ cha-con thì không.
        const parentOf = new Map(rows.map((r) => [r.uid, r.parentUid]));
        const inSubtree = (uid: string): boolean => {
          if (root_uid === undefined) return true;
          let cursor: string | null = uid;
          const seen = new Set<string>();
          while (cursor !== null && !seen.has(cursor)) {
            if (cursor === root_uid) return true;
            seen.add(cursor);
            cursor = parentOf.get(cursor) ?? null;
          }
          return false;
        };

        return jsonResult(
          page(
            rows
              .filter((r) => inSubtree(r.uid) && (max_depth === undefined || r.depth <= max_depth))
              .map(slimRow),
            limit,
            offset,
          ),
        );
      }),
  );

  server.registerTool(
    'wbs_list_tasks',
    {
      title: 'List tasks',
      description:
        'Flat task list with schedule and progress. Every filter is optional; they combine with AND. Paged the same way as wbs_get_tree.',
      inputSchema: {
        project: z.string().min(1),
        phase: z.string().min(1).optional(),
        module: z.string().min(1).optional(),
        assignee: z.string().min(1).optional().describe('Resource id or name'),
        status: z.enum(['not_started', 'in_progress', 'done', 'blocked', 'cancelled']).optional(),
        wbs_prefix: z.string().min(1).optional().describe('e.g. "1.2" for that branch'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe('Rows to return, default 500, hard cap 2000'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    (args) =>
      inProject(args.project, (projectId) =>
        jsonResult(
          page(
            mcpRepo.loadMcpTasks(ctx.db, projectId).filter((row) => {
              if (args.phase !== undefined && row.phase !== args.phase) return false;
              if (args.module !== undefined && row.module !== args.module) return false;
              if (
                args.assignee !== undefined &&
                row.assigneeId !== args.assignee &&
                row.assigneeName !== args.assignee
              ) {
                return false;
              }
              if (args.status !== undefined && row.status !== args.status) return false;
              if (args.wbs_prefix !== undefined) {
                // Chấm ở cuối để "1.2" không nuốt "1.20".
                const p = args.wbs_prefix;
                if (row.wbsCode !== p && !row.wbsCode.startsWith(`${p}.`)) return false;
              }
              return true;
            }),
            args.limit,
            args.offset,
          ),
        ),
      ),
  );

  server.registerTool(
    'wbs_get_task',
    {
      title: 'Get one task in full',
      description:
        'One task with its assignment, progress and dependencies in both directions (§12.1).',
      inputSchema: { uid: z.string().min(1) },
      annotations: readOnly,
    },
    ({ uid }) =>
      onTask(uid, () => {
        const task = mcpRepo.loadMcpTask(ctx.db, uid);
        if (task === undefined) return errorResult(`No task ${uid}.`);
        return jsonResult({ task, dependencies: loadTaskDependencies(ctx.db, uid) });
      }),
  );

  server.registerTool(
    'wbs_get_schedule',
    {
      title: 'Get schedule totals',
      description: 'Project start and end, total MD, task count and counts by status.',
      inputSchema: { project: z.string().min(1) },
      annotations: readOnly,
    },
    ({ project }) =>
      inProject(project, (projectId) => {
        // Chỉ đếm lá: summary là tổng hợp của con nó, cộng cả hai là đếm hai lần cùng
        // một khối lượng (§6.1 — `effort_md` của summary là rollup).
        const leaves = mcpRepo.loadMcpTasks(ctx.db, projectId).filter((r) => r.kind !== 'summary');

        let start: string | null = null;
        let end: string | null = null;
        let totalMd = 0;
        const byStatus: Record<string, number> = {};
        for (const r of leaves) {
          if (r.startDate !== null && (start === null || r.startDate < start)) start = r.startDate;
          if (r.endDate !== null && (end === null || r.endDate > end)) end = r.endDate;
          totalMd += r.effortMd ?? 0;
          byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        }

        return jsonResult({
          projectStart: start,
          projectEnd: end,
          // Cộng dồn số thực sinh đuôi nhị phân (0.1+0.2). Làm tròn 2 chữ số vì MD chỉ
          // có nghĩa tới đó, và một tổng đổi ở chữ số thứ 15 sẽ phá M2.
          totalMd: Math.round(totalMd * 100) / 100,
          taskCount: leaves.length,
          byStatus,
        });
      }),
  );

  server.registerTool(
    'wbs_get_critical_path',
    {
      title: 'Get the critical path',
      description:
        "Tasks on the critical path. mode 'cpm' is the theoretical path from phase A, assuming unlimited people (total_float == 0). mode 'resource' is the real chain after resource levelling (phase C) and follows links created by people, not only by dependencies — a task on it but not on the cpm path is held up by staffing rather than sequencing, which is the cost of being short-staffed (§7.2). In resource mode each row carries strict: true when delaying it by one day delays the whole project, and strict: false when it only left the chain because the assignee's calendar differs from the project's (a Japanese holiday for a VN-scheduled project, say) — those still carry the chain, they just have a day or two of give. Both modes are empty until the project has been scheduled.",
      inputSchema: {
        project: z.string().min(1),
        mode: z.enum(['cpm', 'resource']).default('cpm'),
      },
      annotations: readOnly,
    },
    ({ project, mode }) =>
      inProject(project, (projectId) =>
        jsonResult(mcpRepo.loadCriticalPath(ctx.db, projectId, mode)),
      ),
  );

  server.registerTool(
    'wbs_explain_task',
    {
      title: 'Explain why a task sits where it does',
      description:
        "The scheduler's recorded delay reason and the chain of blockers behind it. Structured, not prose — the chain stops at the first non-dependency link, whose ref is a resource id or a project id.",
      inputSchema: { uid: z.string().min(1) },
      annotations: readOnly,
    },
    ({ uid }) => onTask(uid, () => jsonResult(mcpRepo.explainTask(ctx.db, uid))),
  );

  server.registerTool(
    'wbs_validate',
    {
      title: 'Validate a project',
      description: 'Runs the §8 rules against the current data and returns the ValidationReport.',
      inputSchema: { project: z.string().min(1) },
      annotations: readOnly,
    },
    ({ project }) =>
      inProject(project, (projectId) => {
        const input = importRepo.loadValidationInput(ctx.db, projectId, `mcp-${ctx.now}`);
        if (input === undefined) return errorResult(`No project ${project}.`);
        return jsonResult(validate(input));
      }),
  );

  // ── §12.2 — tool ghi ──────────────────────────────────────────────────────
  registerWriteTools(server, ctx);

  // ── §12.3 — tool chạy ─────────────────────────────────────────────────────
  registerRunTools(server, ctx);

  return server;
}
