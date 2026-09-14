/**
 * Tool ghi của lớp MCP — SPEC.md §12.2, quy tắc ở §12.4.
 *
 * ## Vì sao mọi tool ở đây gọi qua `appRouter.createCaller`
 *
 * Đây là quyết định thiết kế quan trọng nhất của file, nên nói rõ.
 *
 * Cách hiển nhiên là gọi thẳng hàm repo. Nhưng làm vậy thì mỗi đường ghi có HAI bản cài
 * đặt — một cho web, một cho AI — và hai bản đó sẽ trôi khỏi nhau. Chỗ trôi nguy hiểm
 * nhất không phải logic nghiệp vụ mà là ba thứ bao quanh nó: kiểm quyền §10.6, ghi
 * `audit_log` §4.2, và chạy lại validate sau mỗi lần ghi. Quên một trong ba ở nhánh AI
 * thì không test nào của web đỏ, và triệu chứng chỉ hiện ra nhiều tuần sau dưới dạng
 * "sao dữ liệu đổi mà không ai biết ai đổi".
 *
 * Gọi qua caller thì AI đi **đúng cái cửa** người dùng đi. Đó cũng chính là nguyên tắc
 * N1 (§2): AI chỉ đứng ở hai đầu, không có đường riêng vào giữa.
 *
 * Giá phải trả: một lượt `validate` thêm để lấy `ValidationReport` đính kèm (§12.4), vì
 * procedure của web trả `{ ok: true }` và bỏ report đi. Đã đo: 5,4 ms trên fixture 6.000
 * task. Rẻ hơn nhiều so với việc có hai bản cài đặt.
 *
 * ## Transaction
 *
 * §12.4: *"Mọi tool ghi chạy trong transaction. Lỗi → rollback."* Từng procedure đã tự
 * bọc `db.transaction` quanh phần ghi + nhật ký + validate. Không bọc thêm một lớp nữa ở
 * đây: `better-sqlite3` biến transaction lồng thành savepoint, và thêm một tầng chỉ làm
 * khó đọc chứ không đổi tính nguyên tử.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import * as read from '@planix/core/db/repo/read-repo.js';
import * as importRepo from '@planix/core/db/repo/import-repo.js';
import { validate } from '@planix/core/domain/validator.js';
import type { ValidationReport } from '@planix/core/domain/validation-types.js';
import { recordUpdate } from '../audit/audit-log.js';
import { appRouter, type Context } from '../router/index.js';
import { assertCan, ForbiddenError } from '@planix/core/domain/permissions.js';
import { findProjectRole } from '@planix/core/db/repo/auth-repo.js';
import type { McpContext, McpToolResult } from './result.js';
import { errorResult, jsonResult } from './result.js';

/** Ngữ cảnh tRPC dựng từ principal của token. Cùng hình dạng web dùng. */
function callerFor(ctx: McpContext): ReturnType<typeof appRouter.createCaller> {
  const trpcContext: Context = {
    db: ctx.db,
    user: { userId: ctx.principal.userId, isAdmin: ctx.principal.isAdmin },
    now: ctx.now,
    dbPath: ctx.dbPath,
  };
  return appRouter.createCaller(trpcContext);
}

/**
 * §12.4: *"Sau mỗi tool ghi, tự động chạy validate và kèm `ValidationReport` vào
 * response."*
 *
 * Chạy SAU khi ghi xong, trên trạng thái mới — đó là cả điểm: AI cần biết thao tác vừa
 * rồi để lại dự án ở tình trạng nào, không phải tình trạng trước đó.
 */
function reportFor(ctx: McpContext, projectId: string): ValidationReport | null {
  const input = importRepo.loadValidationInput(ctx.db, projectId, `mcp-${ctx.now}`);
  return input === undefined ? null : validate(input);
}

/**
 * Đổi lỗi từ tầng dưới thành kết quả tool.
 *
 * `TRPCError` mang mã máy đọc được (`FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`), nên giữ
 * nguyên mã đó trong thông điệp: AI phản ứng với "không có quyền" khác hẳn với "gõ sai
 * uid", và một câu văn chung chung xoá mất khác biệt ấy.
 */
function toToolError(error: unknown): McpToolResult {
  if (error instanceof TRPCError) return errorResult(`${error.code}: ${error.message}`);
  if (error instanceof ForbiddenError) return errorResult(`FORBIDDEN: ${error.message}`);
  throw error;
}

/**
 * Không phải procedure nào cũng NÉM khi từ chối.
 *
 * `wbsImport.commit` trả `{ ok: false, message, issues }` khi file bị từ chối vì có
 * Critical — cố ý, vì danh sách issue là thứ người dùng cần đọc, không phải một câu lỗi.
 * Nếu ở đây cứ gán cứng `ok: true` thì tool báo THÀNH CÔNG cho một lần import không ghi
 * gì cả. AI đọc `ok: true` rồi đi tiếp như thể dữ liệu đã vào — và nó sẽ không quay lại
 * kiểm tra.
 *
 * Bug này có thật trong bản đầu của file. Test bắt được vì nó đếm số task chứ không chỉ
 * kiểm `isError`.
 */
function innerOk(result: unknown): boolean {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    return result.ok !== false;
  }
  return true;
}

/** Chạy một thao tác ghi rồi đính báo cáo. `projectId` lấy sau khi ghi, không phải trước. */
async function write(
  ctx: McpContext,
  projectId: string | undefined,
  run: () => Promise<unknown>,
): Promise<McpToolResult> {
  try {
    const result = await run();
    const report = projectId === undefined ? null : reportFor(ctx, projectId);
    return jsonResult({ ok: innerOk(result), result, validation: report });
  } catch (error) {
    return toToolError(error);
  }
}

/** Dự án của một task, hoặc lỗi tool nếu uid không tồn tại. */
function projectOf(ctx: McpContext, uid: string): string | McpToolResult {
  const projectId = read.projectOfTask(ctx.db, uid);
  return projectId ?? errorResult(`NOT_FOUND: no task ${uid}.`);
}

function isToolResult(x: string | McpToolResult): x is McpToolResult {
  return typeof x !== 'string';
}

export function registerWriteTools(server: McpServer, ctx: McpContext): void {
  const caller = (): ReturnType<typeof appRouter.createCaller> => callerFor(ctx);

  // Tool ghi KHÔNG phải read-only và KHÔNG idempotent — nói rõ để client biết cái nào
  // hỏi lại người dùng trước khi chạy.
  const writeHint = { readOnlyHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    'wbs_update_task',
    {
      title: 'Update a task',
      description:
        'Change name, effort, role or priority of one task. Dates are NOT editable here — the engine owns them (§2, N3). Returns the ValidationReport for the project afterwards.',
      inputSchema: {
        uid: z.string().min(1),
        name: z.string().min(1),
        effort_md: z.number().nonnegative().nullable(),
        role: z.string().min(1).nullable(),
        priority: z.number().int().min(1),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.uid);
      if (isToolResult(projectId)) return projectId;
      return write(ctx, projectId, () =>
        caller().wbs.updateTask({
          taskUid: args.uid,
          name: args.name,
          effortMd: args.effort_md,
          role: args.role,
          priority: args.priority,
        }),
      );
    },
  );

  server.registerTool(
    'wbs_move_task',
    {
      title: 'Move a task in the tree',
      description:
        'Reparent a task or change its order among siblings. WBS codes are renumbered by the engine afterwards (§4.3) — never hand-edit them.',
      inputSchema: {
        uid: z.string().min(1),
        new_parent_uid: z.string().min(1).nullable(),
        new_sort_order: z.number().int().min(0),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.uid);
      if (isToolResult(projectId)) return projectId;
      return write(ctx, projectId, () =>
        caller().wbs.moveTask({
          taskUid: args.uid,
          newParentUid: args.new_parent_uid,
          newSortOrder: args.new_sort_order,
        }),
      );
    },
  );

  server.registerTool(
    'wbs_delete_subtree',
    {
      title: 'Delete a task and everything under it',
      description:
        'Destructive and not undoable. Call WITHOUT confirm first: it reports how many tasks would be lost and changes nothing. Only then call again with confirm: true.',
      inputSchema: {
        uid: z.string().min(1),
        confirm: z
          .boolean()
          .default(false)
          .describe('false (default) previews; true actually deletes'),
      },
      annotations: { ...writeHint, destructiveHint: true },
    },
    async (args) => {
      const projectId = projectOf(ctx, args.uid);
      if (isToolResult(projectId)) return projectId;

      // §12.2 nói rõ tool này "trả về số task sẽ mất, cần confirm". Hai lượt gọi chứ
      // không phải một: một AI đọc nhầm phạm vi cây sẽ xoá mất nhánh mà không ai kịp
      // ngăn, và không có lệnh hoàn tác. Chính chuyện đó đã xảy ra một lần với dữ liệu
      // demo — mất 20 task vì một lệnh replace-subtree không ai xác nhận.
      if (!args.confirm) {
        try {
          const preview = await caller().wbs.subtreePreview({ taskUid: args.uid });
          return jsonResult({
            ok: false,
            wouldDelete: preview,
            confirmRequired: true,
            note: 'Nothing was deleted. Call again with confirm: true to proceed.',
          });
        } catch (error) {
          return toToolError(error);
        }
      }

      return write(ctx, projectId, () => caller().wbs.deleteSubtree({ taskUid: args.uid }));
    },
  );

  server.registerTool(
    'wbs_set_dependency',
    {
      title: 'Create or update a dependency',
      description:
        'Link two tasks. lag_days may be negative (a lead). The engine refuses links that would create a cycle (C05).',
      inputSchema: {
        pred: z.string().min(1),
        succ: z.string().min(1),
        type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
        lag_days: z.number().default(0),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.succ);
      if (isToolResult(projectId)) return projectId;
      return write(ctx, projectId, () =>
        caller().wbs.setDependency({
          predUid: args.pred,
          succUid: args.succ,
          type: args.type,
          lagDays: args.lag_days,
        }),
      );
    },
  );

  server.registerTool(
    'wbs_delete_dependency',
    {
      title: 'Remove a dependency',
      description: 'Delete one link between two tasks.',
      inputSchema: {
        pred: z.string().min(1),
        succ: z.string().min(1),
        type: z.enum(['FS', 'SS', 'FF', 'SF']),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.succ);
      if (isToolResult(projectId)) return projectId;
      return write(ctx, projectId, () =>
        caller().wbs.deleteDependency({
          predUid: args.pred,
          succUid: args.succ,
          type: args.type,
        }),
      );
    },
  );

  server.registerTool(
    'wbs_set_sequencing',
    {
      title: 'Set how a summary sequences its children',
      description:
        "'parallel' lets children run together (subject to people); 'sequential' forces one after another (§6.3).",
      inputSchema: {
        summary_uid: z.string().min(1),
        mode: z.enum(['parallel', 'sequential']),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.summary_uid);
      if (isToolResult(projectId)) return projectId;
      return write(ctx, projectId, () =>
        caller().wbs.setSequencing({ taskUid: args.summary_uid, mode: args.mode }),
      );
    },
  );

  server.registerTool(
    'wbs_set_progress',
    {
      title: 'Record progress on a task',
      description:
        'Set status and percent on ONE task, with optional actual dates. percent may be omitted only when the status makes it obvious (done, not_started, cancelled). The engine re-forecasts from the status date (§7.11); it never rewrites the past.',
      inputSchema: {
        task_uid: z.string().min(1),
        status: z.enum(['not_started', 'in_progress', 'done', 'blocked', 'cancelled']),
        percent: z.number().min(0).max(100).optional(),
        actual_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        actual_end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        blocked_note: z.string().nullable().optional(),
      },
      annotations: writeHint,
    },
    async (args) => {
      const projectId = projectOf(ctx, args.task_uid);
      if (isToolResult(projectId)) return projectId;
      // §12.2 để `percent` là tuỳ chọn, còn tầng dưới đòi một con số. Chỉ tự điền ở hai
      // trạng thái mà con số là hiển nhiên; `in_progress` thì KHÔNG đoán — bịa ra 50%
      // rồi để nó chảy vào EVM là làm hỏng chính thước đo (§7.13).
      const percent =
        args.percent ??
        (args.status === 'done'
          ? 100
          : args.status === 'not_started' || args.status === 'cancelled'
            ? 0
            : null);
      if (percent === null) {
        return errorResult(`BAD_REQUEST: percent is required when status is ${args.status}.`);
      }

      return write(ctx, projectId, () =>
        caller().progress.save({
          rows: [
            {
              taskUid: args.task_uid,
              status: args.status,
              percent,
              actualStart: args.actual_start ?? null,
              actualEnd: args.actual_end ?? null,
              blockedNote: args.blocked_note ?? null,
            },
          ],
        }),
      );
    },
  );

  server.registerTool(
    'wbs_import',
    {
      title: 'Import a task tree',
      description:
        'Load a §9.2 payload. Call with dry_run: true first — it validates and reports exactly what would change without writing. Any Critical issue rejects the whole file; nothing is imported in part.',
      inputSchema: {
        payload: z.unknown().describe('The §9.2 import payload'),
        dry_run: z.boolean().default(true),
      },
      annotations: writeHint,
    },
    async (args) => {
      try {
        if (args.dry_run) {
          return jsonResult({
            ok: false,
            dryRun: true,
            result: await caller().wbsImport.dryRun({ payload: args.payload }),
            note: 'Nothing was written. Call again with dry_run: false to apply.',
          });
        }
        const committed = await caller().wbsImport.commit({ payload: args.payload });
        return jsonResult({ ok: innerOk(committed), dryRun: false, result: committed });
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'wbs_pin_resource',
    {
      title: 'Pin a person to a task',
      description:
        'Force the engine to use this person for this task, or pass null to unpin. The engine will NOT move a pinned person even when that overloads them (N4) — it reports J01 instead.',
      inputSchema: {
        task_uid: z.string().min(1),
        resource_id: z.string().min(1).nullable(),
      },
      annotations: writeHint,
    },
    (args) => {
      const projectId = projectOf(ctx, args.task_uid);
      if (isToolResult(projectId)) return projectId;

      try {
        // §10.6 — không có procedure web tương ứng (không màn nào cho ghim người), nên
        // lớp kiểm quyền phải nằm ngay ở đây chứ không mượn được của ai.
        const assignment = findProjectRole(ctx.db, ctx.principal.userId, projectId);
        assertCan('edit_wbs', {
          isAdmin: ctx.principal.isAdmin,
          projectRole: assignment?.role ?? null,
        });
      } catch (error) {
        return toToolError(error);
      }

      if (args.resource_id !== null) {
        const exists = ctx.db.prepare('SELECT 1 FROM resource WHERE id = ?').get(args.resource_id);
        if (exists === undefined) {
          return errorResult(`NOT_FOUND: no resource ${args.resource_id}.`);
        }
      }

      const before = read.loadPinnedResource(ctx.db, args.task_uid);
      if (before === undefined) return errorResult(`NOT_FOUND: no task ${args.task_uid}.`);

      // Ghi dữ liệu và nhật ký trong CÙNG transaction: có vết mà không có thay đổi, hoặc
      // ngược lại, đều tệ hơn là không có gì.
      ctx.db.transaction(() => {
        read.setPinnedResource(ctx.db, args.task_uid, args.resource_id, ctx.now);
        recordUpdate(
          ctx.db,
          { userId: ctx.principal.userId, at: ctx.now },
          'task',
          args.task_uid,
          { pinnedResource: before },
          { pinnedResource: args.resource_id },
        );
      })();

      return jsonResult({
        ok: true,
        result: { taskUid: args.task_uid, pinnedResource: args.resource_id },
        validation: reportFor(ctx, projectId),
      });
    },
  );
}
