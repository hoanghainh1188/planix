/**
 * Tool chạy của lớp MCP — SPEC.md §12.3.
 *
 * Ba tool ở đây, không phải bốn: `wbs_what_if` thuộc P14 theo §14.1. Nó cũng là tool duy
 * nhất trong §12.3 có ràng buộc riêng (*"chạy trên bản sao DB trong RAM. Tuyệt đối không
 * ghi"*), nên nhét vội vào đây sẽ là chỗ dễ sai nhất của cả lớp MCP.
 *
 * Cùng nguyên tắc với `write-tools.ts`: gọi qua `appRouter.createCaller` để AI đi đúng
 * cái cửa người dùng đi (N1). Ngoại lệ là `wbs_export_excel` — đường xuất của web là một
 * route HTTP đọc session cookie, không phải procedure tRPC, nên không mượn được. Chỗ đó
 * phải tự dựng lại lớp kiểm quyền, và đó cũng là chỗ dễ quên nhất.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exportExcel, ExportBlockedError } from '@planix/core/io/excel/index.js';
import { findProjectRole } from '@planix/core/db/repo/auth-repo.js';
import * as importRepo from '@planix/core/db/repo/import-repo.js';
import { runWhatIf, WhatIfChangeError, type WhatIfChange } from '@planix/core/pipeline/what-if.js';
import { assertCan, ForbiddenError } from '@planix/core/domain/permissions.js';
import { appRouter, type Context } from '../router/index.js';
import { TRPCError } from '@trpc/server';
import type { McpContext, McpToolResult } from './result.js';
import { errorResult, jsonResult } from './result.js';

function callerFor(ctx: McpContext): ReturnType<typeof appRouter.createCaller> {
  const trpcContext: Context = {
    db: ctx.db,
    user: { userId: ctx.principal.userId, isAdmin: ctx.principal.isAdmin },
    now: ctx.now,
    dbPath: ctx.dbPath,
  };
  return appRouter.createCaller(trpcContext);
}

function toToolError(error: unknown): McpToolResult {
  if (error instanceof TRPCError) return errorResult(`${error.code}: ${error.message}`);
  if (error instanceof ForbiddenError) return errorResult(`FORBIDDEN: ${error.message}`);
  throw error;
}

/** Đổi mã dự án (`UTG`) hoặc id sang id — cùng quy ước với tool đọc. */
function resolveProjectId(ctx: McpContext, projectRef: string): string | undefined {
  const byCode = importRepo.findProjectByCode(ctx.db, projectRef);
  if (byCode !== undefined) return byCode.id;
  const byId = ctx.db.prepare('SELECT id FROM project WHERE id = ?').get(projectRef) as
    { id: string } | undefined;
  return byId?.id;
}

export function registerRunTools(server: McpServer, ctx: McpContext): void {
  const caller = (): ReturnType<typeof appRouter.createCaller> => callerFor(ctx);
  const runHint = { readOnlyHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    'wbs_what_if',
    {
      title: 'Try a change without saving it',
      description:
        "Run a hypothetical: apply changes to an in-memory copy, reschedule, and report what would move. NOTHING is written — the real project is untouched (§12.4). The comparison point is the project rescheduled WITHOUT your changes, not the currently stored schedule, so the slips you see are caused by your change alone; storedProjectEnd tells you separately whether a plain recalculation would already move the end date. The headline question this answers is §7.2's: how much earlier would we finish with one more person.",
      inputSchema: {
        project: z.string().min(1),
        changes: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({
                kind: z.literal('set_effort'),
                task_uid: z.string().min(1),
                effort_md: z.number().nonnegative(),
              }),
              z.object({
                kind: z.literal('pin_resource'),
                task_uid: z.string().min(1),
                resource_id: z.string().min(1).nullable(),
              }),
              z.object({
                kind: z.literal('add_resource'),
                resource_id: z.string().min(1),
                name: z.string().min(1),
                roles: z.array(z.string().min(1)).min(1),
                location_id: z.string().min(1).optional(),
              }),
              z.object({ kind: z.literal('remove_resource'), resource_id: z.string().min(1) }),
              z.object({
                kind: z.literal('set_dependency'),
                pred: z.string().min(1),
                succ: z.string().min(1),
                type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
                lag_days: z.number().default(0),
              }),
              z.object({
                kind: z.literal('remove_dependency'),
                pred: z.string().min(1),
                succ: z.string().min(1),
                type: z.enum(['FS', 'SS', 'FF', 'SF']),
              }),
            ]),
          )
          .min(1)
          .max(50),
      },
      // `readOnlyHint: true` là đúng và quan trọng: tool này KHÔNG đổi gì, và client nên
      // biết để khỏi hỏi người dùng xác nhận như với một thao tác ghi.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => {
      const projectId = resolveProjectId(ctx, args.project);
      if (projectId === undefined) return errorResult(`NOT_FOUND: no project ${args.project}.`);

      // §10.6: what-if xếp lại lịch (dù chỉ trên bản sao), nên đòi đúng quyền của người
      // được xếp lịch dự án — không phải quyền xem. Một người chỉ được xem không nên suy
      // ra được lịch sẽ thành thế nào nếu bỏ bớt người.
      try {
        const assignment = findProjectRole(ctx.db, ctx.principal.userId, projectId);
        assertCan('recalculate_project', {
          isAdmin: ctx.principal.isAdmin,
          projectRole: assignment?.role ?? null,
        });
      } catch (error) {
        return toToolError(error);
      }

      const changes: WhatIfChange[] = args.changes.map((c) => {
        switch (c.kind) {
          case 'set_effort':
            return { kind: 'set_effort', taskUid: c.task_uid, effortMd: c.effort_md };
          case 'pin_resource':
            return { kind: 'pin_resource', taskUid: c.task_uid, resourceId: c.resource_id };
          case 'add_resource':
            return {
              kind: 'add_resource',
              resourceId: c.resource_id,
              name: c.name,
              roles: c.roles,
              ...(c.location_id === undefined ? {} : { locationId: c.location_id }),
            };
          case 'remove_resource':
            return { kind: 'remove_resource', resourceId: c.resource_id };
          case 'set_dependency':
            return {
              kind: 'set_dependency',
              predUid: c.pred,
              succUid: c.succ,
              type: c.type,
              lagDays: c.lag_days,
            };
          case 'remove_dependency':
            return {
              kind: 'remove_dependency',
              predUid: c.pred,
              succUid: c.succ,
              type: c.type,
            };
        }
      });

      try {
        return jsonResult(
          runWhatIf(ctx.db, { projectId, changes, runId: `whatif-${ctx.now}`, now: ctx.now }),
        );
      } catch (error) {
        // Thay đổi trỏ vào thứ không tồn tại là lỗi của người gọi, không phải sự cố máy
        // chủ — nói rõ để AI sửa tham số thay vì thử lại y nguyên.
        if (error instanceof WhatIfChangeError) return errorResult(`BAD_REQUEST: ${error.message}`);
        throw error;
      }
    },
  );

  server.registerTool(
    'wbs_schedule',
    {
      title: 'Recalculate the schedule',
      description:
        "Run the engine: CPM, resource levelling, then the §8 rules. scope 'all' reschedules every project sharing the resource pool in priority order (§7.12) and needs a higher permission than one project. This is the ONLY way dates ever change — no tool writes a date directly (N1).",
      inputSchema: {
        project: z.string().min(1).describe('Project id or code'),
        scope: z.enum(['project', 'all']).default('project'),
      },
      annotations: runHint,
    },
    async ({ project, scope }) => {
      const projectId = resolveProjectId(ctx, project);
      if (projectId === undefined) return errorResult(`NOT_FOUND: no project ${project}.`);
      try {
        return jsonResult(await caller().wbs.recalculate({ projectId, scope }));
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'wbs_close_period',
    {
      title: 'Close the period and take a baseline',
      description:
        'Set the status date and snapshot the plan. Every later EVM figure is measured against this snapshot, so §7.13 REFUSES to close while any Critical issue stands — unlike other writes, which go through and report. A refusal comes back as ok:false with the blocking issues, not as an error.',
      inputSchema: {
        project: z.string().min(1),
        status_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        label: z.string().min(1).max(60).describe('e.g. "Plan v1.0"'),
      },
      annotations: runHint,
    },
    async (args) => {
      const projectId = resolveProjectId(ctx, args.project);
      if (projectId === undefined) return errorResult(`NOT_FOUND: no project ${args.project}.`);
      try {
        const result = await caller().period.close({
          projectId,
          statusDate: args.status_date,
          label: args.label,
        });
        return jsonResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'wbs_export_excel',
    {
      title: 'Export an Excel report',
      description:
        "Build one of the three §11.1 reports. 'full' is every task in 12 columns; 'summary' is the rolled-up Japanese sheet for the client; 'resource' is the people × weeks matrix. The file comes back base64-encoded, which for a 600-task 'full' report is about 50 KB — pass include_file: false when you only want to know whether the export would succeed. A Critical issue blocks the export entirely (§11.4); Major issues do not, but they are listed in warnings.",
      inputSchema: {
        project: z.string().min(1),
        report: z.enum(['full', 'summary', 'resource']).default('full'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe("Hierarchy levels, 'summary' report only (§11.3)"),
        include_file: z.boolean().default(true),
      },
      annotations: runHint,
    },
    async (args) => {
      const projectId = resolveProjectId(ctx, args.project);
      if (projectId === undefined) return errorResult(`NOT_FOUND: no project ${args.project}.`);

      // Không có procedure tRPC cho xuất file — web dùng một route HTTP riêng đọc session
      // cookie. Nên lớp kiểm quyền phải dựng lại ở đây, và phải kèm `reportKind`: §10.6
      // cho lead bản `full` thôi, thiếu nó là mở cửa cho lead tải bản `resource` (ma trận
      // năng lực toàn đội).
      try {
        const assignment = findProjectRole(ctx.db, ctx.principal.userId, projectId);
        assertCan('export_report', {
          isAdmin: ctx.principal.isAdmin,
          projectRole: assignment?.role ?? null,
          reportKind: args.report,
        });
      } catch (error) {
        return toToolError(error);
      }

      try {
        const result = await exportExcel(ctx.db, {
          projectId,
          report: args.report,
          runId: `mcp-export-${ctx.now}`,
          ...(args.depth === undefined ? {} : { depth: args.depth }),
        });

        const meta = {
          ok: true,
          filename: result.filename,
          bytes: result.buffer.length,
          // §11.4: Major vẫn xuất, nhưng người tải phải BIẾT. Trả trong dữ liệu chứ không
          // chèn vào file — sửa nội dung file là làm hỏng chính thứ §14.5 so byte-for-byte.
          warnings: result.warnings,
          fileIncluded: args.include_file,
        };

        if (!args.include_file) return jsonResult(meta);

        return {
          content: [
            { type: 'text', text: JSON.stringify(meta, null, 2) },
            {
              type: 'resource',
              resource: {
                uri: `planix://export/${result.filename}`,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                blob: result.buffer.toString('base64'),
              },
            },
          ],
          structuredContent: { result: meta },
        };
      } catch (error) {
        if (error instanceof ExportBlockedError) {
          // §11.4 chặn hẳn khi có Critical. Trả về dữ liệu có cấu trúc chứ không phải một
          // câu lỗi: AI cần ĐỌC danh sách để đi sửa, và `isError` chỉ mang được một câu.
          return jsonResult({
            ok: false,
            blocked: true,
            reason: 'The project has Critical issues; §11.4 refuses to export.',
            issues: error.report.issues.filter((i) => i.severity === 'Critical'),
          });
        }
        return errorResult(error instanceof Error ? error.message : 'export_failed');
      }
    },
  );
}
