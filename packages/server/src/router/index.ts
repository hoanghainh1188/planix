/**
 * tRPC router — SPEC.md §10.3 màn S0, S1, S3, S4, S6; §10.6 phân quyền.
 *
 * §10.6 chốt: **kiểm tra quyền ở server, không chỉ ẩn nút trên UI.** Mọi procedure ở
 * đây gọi `assertCan` trước khi chạm dữ liệu; UI chỉ dùng cùng bảng đó để quyết định
 * hiện hay ẩn, không phải để gác.
 *
 * N1: không procedure nào ghi vào `schedule` hay `assignment`. Đường duy nhất tới hai
 * bảng đó là scheduler.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Db } from '@planix/core/db/migrate.js';
import * as authRepo from '@planix/core/db/repo/auth-repo.js';
import * as read from '@planix/core/db/repo/read-repo.js';
import * as baselineRepo from '@planix/core/db/repo/baseline-repo.js';
import { validateProgressEntry } from '@planix/core/domain/progress-suggest.js';
import { validate } from '@planix/core/domain/validator.js';
import { poolLoad, LoadWindowTooWideError } from '@planix/core/domain/resource-load.js';
import { createCalendarEngine } from '@planix/core/domain/calendar.js';
import { loadCalendarSnapshot } from '@planix/core/db/repo/calendar-repo.js';
import { unsafeDateOnly } from '@planix/core/domain/date-only.js';
import * as importRepo from '@planix/core/db/repo/import-repo.js';
import * as mcpRepo from '@planix/core/db/repo/mcp-repo.js';
import * as adminRepo from '@planix/core/db/repo/admin-repo.js';
import type { ValidationIssue, ValidationReport } from '@planix/core/domain/validation-types.js';
import { recordValidationRun } from '@planix/core/db/repo/issue-repo.js';
import * as issueRepo from '@planix/core/db/repo/issue-repo.js';
import { moveRejectionMessage } from '@planix/core/domain/move.js';
import { dryRunImport, ImportValidationError, importTasks } from '@planix/core/io/importer.js';
import { closePeriod, PeriodNotClosedError } from '@planix/core/db/repo/baseline-repo.js';
import { previewRecalculate } from '../scheduler/preview.js';
import {
  assertCan,
  ForbiddenError,
  type PermissionContext,
} from '@planix/core/domain/permissions.js';
import { recordUpdate } from '../audit/audit-log.js';
import { runSchedulerInWorker } from '../scheduler/run-in-worker.js';

export interface Context {
  readonly db: Db;
  readonly user: { userId: string; isAdmin: boolean } | null;
  /** Thời điểm của request. Truyền vào chứ không đọc đồng hồ trong logic. */
  readonly now: string;
  /** Đường dẫn file DB, cần cho worker lập lịch (§7.14). */
  readonly dbPath: string;
}

/**
 * `stack` bị GỠ khỏi mọi lỗi trả về.
 *
 * Mặc định tRPC kèm stack trace khi `NODE_ENV !== 'production'`, nghĩa là một client CHƯA
 * đăng nhập nhận được đường dẫn tuyệt đối trên máy chủ chỉ bằng một request hỏng. Không
 * dựa vào biến môi trường được đặt đúng: quên đặt một lần là rò ngay ở production.
 */
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape }) {
    const data = { ...shape.data };
    delete data.stack;
    return { ...shape, data };
  },
});

/** Mọi procedure đều đòi đăng nhập: §13.3 không có đăng ký công khai, không có khách. */
const authed = t.procedure.use(({ ctx, next }) => {
  if (ctx.user === null) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Dựng ngữ cảnh quyền cho MỘT dự án.
 *
 * Vai đọc từ `user_project` mỗi request, không cache vào phiên: admin thu hồi quyền thì
 * phải có hiệu lực ngay, không đợi người kia đăng xuất.
 */
function permissionContext(
  ctx: Context & { user: { userId: string; isAdmin: boolean } },
  projectId: string,
  extra: Omit<PermissionContext, 'isAdmin' | 'projectRole'> = {},
): PermissionContext & { teamId: string | null } {
  const assignment = authRepo.findProjectRole(ctx.db, ctx.user.userId, projectId);
  return {
    isAdmin: ctx.user.isAdmin,
    projectRole: assignment?.role ?? null,
    teamId: assignment?.teamId ?? null,
    ...extra,
  };
}

/** Ngày dạng `YYYY-MM-DD`. Dùng chung để ba chỗ không tự chế ba biểu thức khác nhau. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * S5 là màn TOÀN CỤC (§10.3), nên quyền không gắn với dự án nào.
 *
 * `assertCan` cần một `projectRole`, mà ở đây không có dự án để tra vai. §10.6 đặt
 * `manage_resources` là `{pm: false, lead: false}` — chỉ admin — nên `projectRole: null`
 * là đúng ngữ nghĩa: người này không đứng trong dự án nào khi làm việc này.
 */
/**
 * Người này có đứng vai `pm` ở ÍT NHẤT một dự án không.
 *
 * S9 là màn toàn cục nên không có "dự án đang xét" để tra vai, nhưng §10.6 vẫn cho
 * `view_resource_pool` theo vai chứ không theo tài khoản. Cách đọc đúng của bảng: người
 * làm PM ở đâu đó thì được nhìn pool, còn lead thì không — và một người chưa được gán
 * vào dự án nào thì cũng chưa có lý do gì để nhìn.
 */
function pmSomewhere(ctx: Context & { user: { userId: string; isAdmin: boolean } }): boolean {
  const row = ctx.db
    .prepare(`SELECT 1 FROM user_project WHERE user_id = ? AND role = 'pm' LIMIT 1`)
    .get(ctx.user.userId);
  return row !== undefined;
}

function requireAdmin(ctx: Context & { user: { userId: string; isAdmin: boolean } }): void {
  try {
    assertCan('manage_resources', { isAdmin: ctx.user.isAdmin, projectRole: null });
  } catch (e) {
    toTrpc(e);
  }
}

function toTrpc(error: unknown): never {
  if (error instanceof ForbiddenError) {
    throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
  }
  throw error;
}

/**
 * Chạy validate cho MỘT dự án trên trạng thái DB hiện tại (§8).
 *
 * §12.4: "sau mỗi tool ghi, tự động chạy validate và kèm `ValidationReport` vào response."
 * Ghi vẫn được thực hiện kể cả khi sinh ra Critical — chặn ở đây là tự đặt thêm một luật
 * không có trong spec, và nó sẽ khoá PM lại giữa chừng một chuỗi sửa nhiều bước mà trạng
 * thái trung gian nào cũng tạm thời sai.
 *
 * Đo trên fixture 6.000 task: load + validate hết 5,4 ms.
 */
function validateProject(db: Db, projectId: string, runId: string): ValidationReport {
  const input = importRepo.loadValidationInput(db, projectId, runId);
  if (input === undefined) {
    // Không có dự án nào mang id đó. Báo "sạch" chứ không ném: người gọi đã qua
    // `assertCan`, nên tới đây chỉ còn trường hợp dự án vừa bị xoá.
    return {
      runId,
      projectId,
      passed: true,
      counts: { critical: 0, major: 0, minor: 0 },
      issues: [],
    };
  }
  return validate(input);
}

/**
 * Chạy validate sau MỘT thao tác ghi WBS và lưu kết quả — PM quyết ngày 2026-09-13.
 *
 * §8 chỉ liệt kê ba chỗ (import, schedule, lưu progress), nên trước đây sửa task hay đổi
 * cha xong thì panel S6 vẫn hiện ảnh chụp cũ cho tới lần xếp lịch kế tiếp. PM chọn mở ra
 * mọi thao tác ghi, nên panel luôn khớp với thứ đang nhìn thấy.
 *
 * Chi phí đã đo trên fixture 6.000 task: 5,4 ms một lượt. Lượt nào không làm đổi tập issue
 * thì `recordValidationRun` chỉ đẩy `last_at` — không đẻ dòng lịch sử, không ghi lại issue.
 *
 * Gọi TRONG transaction của thao tác: ghi hỏng giữa chừng thì cả thay đổi lẫn báo cáo về
 * nó cùng biến mất.
 */
function revalidateAfterEdit(
  ctx: Context & { user: { userId: string; isAdmin: boolean } },
  projectId: string,
): ValidationReport {
  const runId = `edit-${ctx.now}`;
  const report = validateProject(ctx.db, projectId, runId);
  recordValidationRun(ctx.db, {
    runId,
    projectId,
    detectedAt: ctx.now,
    source: 'edit',
    issues: report.issues,
  });
  return report;
}

/**
 * Phần báo cáo dính tới cạnh vừa sửa, để hiện ngay tại panel Links (§12.4).
 *
 * Lọc theo hai đầu của cạnh, cộng `C01`: vòng lặp được gắn vào một đỉnh bất kỳ trên đường
 * đi, không nhất thiết là một trong hai đầu.
 */
/**
 * Đọc `project_code` / `mode` / `root_uid` từ payload thô, ĐỦ để kiểm quyền.
 *
 * Không dùng `ImportPayloadSchema` ở đây: quyền phải được kiểm trước khi ta nói bất cứ
 * điều gì về file, và một file sai schema vẫn cần nói rõ "bạn không được nạp vào dự án
 * này" thay vì tiết lộ chi tiết cấu trúc. Chỉ lấy ba trường, phần còn lại để importer lo.
 */
function resolveImportTarget(
  ctx: Context & { user: { userId: string; isAdmin: boolean } },
  payload: unknown,
): { projectId: string; projectCode: string; mode: string; rootUid: string | null } {
  if (typeof payload !== 'object' || payload === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The file must be a JSON object.' });
  }
  const raw = payload as Record<string, unknown>;
  const projectCode = raw['project_code'];
  if (typeof projectCode !== 'string' || projectCode === '') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The file has no project_code.' });
  }

  const project = ctx.db.prepare('SELECT id FROM project WHERE code = ?').get(projectCode) as
    { id: string } | undefined;
  if (project === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `No project with code ${projectCode}.` });
  }

  try {
    assertCan('import_from_ai', permissionContext(ctx, project.id));
  } catch (e) {
    toTrpc(e);
  }

  const mode = raw['mode'] === 'replace-subtree' ? 'replace-subtree' : 'merge';
  const rootUid =
    mode === 'replace-subtree' && typeof raw['root_uid'] === 'string' ? raw['root_uid'] : null;
  return { projectId: project.id, projectCode, mode, rootUid };
}

/**
 * Đổi lỗi của importer thành thứ hiện được lên màn hình.
 *
 * `ImportValidationError` mang theo `ValidationReport` — đó là thứ PM cần đọc, không phải
 * câu "Import rejected: C01, C07". Lỗi schema của zod thì ngược lại: thông điệp của nó đã
 * chỉ đúng trường sai, nên giữ nguyên.
 */
function describeImportFailure(error: unknown): {
  message: string;
  issues: readonly ValidationIssue[];
} {
  if (error instanceof ImportValidationError) {
    return {
      message: 'The file was rejected: it would leave the project in an invalid state.',
      issues: error.report.issues,
    };
  }
  if (error instanceof TRPCError) throw error;
  return { message: error instanceof Error ? error.message : String(error), issues: [] };
}

function issuesForEdge(report: ValidationReport, endpoints: readonly string[]): ValidationIssue[] {
  const touched = new Set(endpoints);
  return report.issues.filter(
    (i) => i.code === 'C01' || (i.taskUid !== undefined && touched.has(i.taskUid)),
  );
}

export const appRouter = t.router({
  // ── S0 — Project switcher ────────────────────────────────────────────────
  projects: t.router({
    list: authed.query(({ ctx }) =>
      authRepo.listUserProjects(ctx.db, ctx.user.userId, ctx.user.isAdmin),
    ),
  }),

  // ── S1 — WBS tree ────────────────────────────────────────────────────────
  wbs: t.router({
    tree: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      return read.loadWbsTree(ctx.db, input.projectId);
    }),

    updateTask: authed
      .input(
        z.object({
          taskUid: z.string().min(1),
          name: z.string().min(1),
          effortMd: z.number().nullable(),
          role: z.string().nullable(),
          priority: z.number().int(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }

        const before = read.loadTaskForEdit(ctx.db, input.taskUid);
        if (before === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        const after = {
          name: input.name,
          effortMd: input.effortMd,
          role: input.role,
          priority: input.priority,
        };

        // Ghi dữ liệu và nhật ký trong CÙNG transaction: có vết mà không có thay đổi,
        // hoặc ngược lại, đều tệ hơn là không có gì.
        ctx.db.transaction(() => {
          read.updateTaskFields(ctx.db, input.taskUid, after, ctx.now);
          recordUpdate(
            ctx.db,
            { userId: ctx.user.userId, at: ctx.now },
            'task',
            input.taskUid,
            before,
            after,
          );
          revalidateAfterEdit(ctx, projectId);
        })();
        return { ok: true as const };
      }),

    /**
     * S2 — mọi thứ về MỘT task (quyết định 2026-09-14).
     *
     * Gọi đúng hàm mà `wbs_get_task` và `wbs_explain_task` của lớp MCP đang dùng. Cố ý:
     * hai câu truy vấn gần giống nhau cho cùng một câu hỏi sẽ trôi khỏi nhau, và khi đó
     * PM với AI nhìn thấy hai phiên bản khác nhau của cùng một task.
     */
    detail: authed.input(z.object({ taskUid: z.string().min(1) })).query(({ ctx, input }) => {
      const projectId = read.projectOfTask(ctx.db, input.taskUid);
      if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      try {
        assertCan('view_assigned_project', permissionContext(ctx, projectId));
      } catch (e) {
        toTrpc(e);
      }

      const task = mcpRepo.loadMcpTask(ctx.db, input.taskUid);
      if (task === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        task,
        dependencies: read.loadTaskDependencies(ctx.db, input.taskUid),
        explanation: mcpRepo.explainTask(ctx.db, input.taskUid),
      };
    }),

    /**
     * S2 — sửa nhóm nhãn phân loại.
     *
     * Tách khỏi `updateTask` chứ không gộp: hai nhóm sửa ở hai màn khác nhau, và gộp lại
     * thì mỗi lần lưu một bên sẽ ghi đè bên kia bằng giá trị cũ nó đang giữ trong state.
     *
     * Chuỗi rỗng quy về `null` ngay tại biên: `phase = ''` và `phase = NULL` là hai thứ
     * khác nhau với SQL nhưng cùng nghĩa "chưa đặt" với người dùng, và `N03` chỉ kiểm
     * `NULL`. Không quy về thì xoá trắng một ô sẽ làm rule im lặng trong khi dữ liệu vẫn
     * thiếu.
     */
    updateLabels: authed
      .input(
        z.object({
          taskUid: z.string().min(1),
          description: z.string().nullable(),
          category: z.string().nullable(),
          phase: z.string().nullable(),
          module: z.string().nullable(),
          externalRef: z.string().nullable(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }

        const before = read.loadTaskLabels(ctx.db, input.taskUid);
        if (before === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        const blank = (v: string | null): string | null => {
          const t = v?.trim() ?? '';
          return t === '' ? null : t;
        };
        const after = {
          description: blank(input.description),
          category: blank(input.category),
          phase: blank(input.phase),
          module: blank(input.module),
          externalRef: blank(input.externalRef),
        };

        // Ghi dữ liệu và nhật ký trong CÙNG transaction: có vết mà không có thay đổi,
        // hoặc ngược lại, đều tệ hơn là không có gì.
        const report = ctx.db.transaction((): ValidationReport => {
          read.updateTaskLabels(ctx.db, input.taskUid, after, ctx.now);
          recordUpdate(
            ctx.db,
            { userId: ctx.user.userId, at: ctx.now },
            'task',
            input.taskUid,
            before,
            after,
          );
          return revalidateAfterEdit(ctx, projectId);
        })();

        // Trả kèm báo cáo: sửa `phase`/`module` là cách DUY NHẤT vá `N03`, nên panel phải
        // thấy ngay issue vừa biến mất thay vì đợi lượt tải sau.
        return { ok: true as const, validation: report };
      }),

    /** §10.4 — thêm một task vào cây. Trước đây chỉ importer ghi được vào bảng `task`. */
    createTask: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          parentUid: z.string().min(1).nullable(),
          name: z.string().min(1),
          kind: z.enum(['summary', 'work', 'milestone']),
          effortMd: z.number().nonnegative().nullable(),
          role: z.string().nullable(),
          priority: z.number().int().default(500),
          afterUid: z.string().min(1).nullable().default(null),
        }),
      )
      .mutation(({ ctx, input }) => {
        try {
          assertCan('edit_wbs', permissionContext(ctx, input.projectId));
        } catch (e) {
          toTrpc(e);
        }
        try {
          return ctx.db.transaction(() => {
            const result = read.createTask(ctx.db, { ...input, now: ctx.now });
            recordUpdate(
              ctx.db,
              { userId: ctx.user.userId, at: ctx.now },
              'task',
              result.uid,
              {},
              { name: input.name, kind: input.kind, parentUid: input.parentUid },
            );
            revalidateAfterEdit(ctx, input.projectId);
            return result;
          })();
        } catch (e) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: e instanceof Error ? e.message : 'Cannot create task',
            cause: e,
          });
        }
      }),

    /**
     * §12.2: "trả về số task sẽ mất, cần confirm".
     *
     * Đây là QUERY, không phải mutation: nó chỉ đếm. Xoá một summary kéo theo cả nhánh,
     * và `ON DELETE CASCADE` kéo theo cả tiến độ đã nhập — lịch thì tính lại được, tiến
     * độ do người gõ thì không.
     */
    subtreePreview: authed
      .input(z.object({ taskUid: z.string().min(1) }))
      .query(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }
        const info = read.subtreeOf(ctx.db, input.taskUid);
        return { taskCount: info.uids.length, progressRows: info.progressRows };
      }),

    deleteSubtree: authed
      .input(z.object({ taskUid: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }
        return ctx.db.transaction(() => {
          const info = read.subtreeOf(ctx.db, input.taskUid);
          // Ghi vết TRƯỚC khi xoá: sau khi xoá thì không còn gì để mô tả.
          recordUpdate(
            ctx.db,
            { userId: ctx.user.userId, at: ctx.now },
            'task',
            input.taskUid,
            { deleted: false },
            { deleted: true, taskCount: info.uids.length },
          );
          const removed = read.deleteSubtree(ctx.db, input.taskUid, projectId);
          revalidateAfterEdit(ctx, projectId);
          return { removed };
        })();
      }),

    setDependency: authed
      .input(
        z.object({
          predUid: z.string().min(1),
          succUid: z.string().min(1),
          type: z.enum(['FS', 'SS', 'FF', 'SF']),
          lagDays: z.number().default(0),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.succUid);
        const predProject = read.projectOfTask(ctx.db, input.predUid);
        if (projectId === undefined || predProject === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        // §6 nói về ràng buộc TRONG một dự án. Nối xuyên dự án sẽ làm CPM chạy trên một
        // đồ thị mà scheduler không bao giờ xếp cùng lúc.
        if (projectId !== predProject) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A dependency cannot cross projects.',
          });
        }
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }
        let report;
        try {
          report = ctx.db.transaction(() => {
            read.setDependency(ctx.db, input);
            recordUpdate(
              ctx.db,
              { userId: ctx.user.userId, at: ctx.now },
              'dependency',
              `${input.predUid}->${input.succUid}`,
              {},
              { type: input.type, lagDays: input.lagDays },
            );
            return revalidateAfterEdit(ctx, projectId);
          })();
        } catch (e) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: e instanceof Error ? e.message : 'Cannot set dependency',
            cause: e,
          });
        }
        // Một lượt validate, hai người dùng: bảng `validation_issue` cho panel S6, và phần
        // lọc theo cạnh cho panel Links ngay tại chỗ vừa bấm.
        return { ok: true as const, issues: issuesForEdge(report, [input.predUid, input.succUid]) };
      }),

    deleteDependency: authed
      .input(
        z.object({
          predUid: z.string().min(1),
          succUid: z.string().min(1),
          type: z.enum(['FS', 'SS', 'FF', 'SF']),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.succUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }
        const { removed, report } = ctx.db.transaction(() => ({
          removed: read.deleteDependency(ctx.db, input),
          report: revalidateAfterEdit(ctx, projectId),
        }))();
        return { removed, issues: issuesForEdge(report, [input.predUid, input.succUid]) };
      }),

    /** Ràng buộc của MỘT task, cả hai chiều — nguồn dữ liệu cho panel nối task. */
    dependencies: authed.input(z.object({ taskUid: z.string().min(1) })).query(({ ctx, input }) => {
      const projectId = read.projectOfTask(ctx.db, input.taskUid);
      if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      // Chỉ cần quyền XEM: lead phải đọc được ràng buộc để hiểu vì sao task của mình
      // bắt đầu muộn, dù không được sửa (§10.6).
      try {
        assertCan('view_assigned_project', permissionContext(ctx, projectId));
      } catch (e) {
        toTrpc(e);
      }
      return read.loadTaskDependencies(ctx.db, input.taskUid);
    }),

    /** §10.4 — kéo thả đổi cha và `sort_order`, engine tự đánh số lại. */
    moveTask: authed
      .input(
        z.object({
          taskUid: z.string().min(1),
          newParentUid: z.string().min(1).nullable(),
          newSortOrder: z.number().int(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }

        const before = read.loadTaskForEdit(ctx.db, input.taskUid);
        if (before === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        try {
          // Đổi cha + đánh số lại nằm trong MỘT transaction: renumber hỏng giữa chừng
          // sẽ để lại cây có hai task cùng `wbs_code`, tệ hơn lúc chưa đụng vào.
          return ctx.db.transaction(() => {
            const result = read.moveTask(ctx.db, { ...input, now: ctx.now });
            recordUpdate(
              ctx.db,
              { userId: ctx.user.userId, at: ctx.now },
              'task',
              input.taskUid,
              { parentUid: null },
              { parentUid: input.newParentUid, sortOrder: input.newSortOrder },
            );
            revalidateAfterEdit(ctx, projectId);
            return result;
          })();
        } catch (e) {
          if (e instanceof read.MoveRejectedError) {
            // Lý do hiện thẳng lên UI, không để người dùng đoán vì sao bị chặn.
            throw new TRPCError({ code: 'BAD_REQUEST', message: moveRejectionMessage(e.reason) });
          }
          throw e;
        }
      }),

    /** §10.4 — công tắc Parallel / Sequential trên dòng summary (§6.3). */
    setSequencing: authed
      .input(
        z.object({
          taskUid: z.string().min(1),
          mode: z.enum(['parallel', 'sequential']),
        }),
      )
      .mutation(({ ctx, input }) => {
        const projectId = read.projectOfTask(ctx.db, input.taskUid);
        if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        try {
          assertCan('edit_wbs', permissionContext(ctx, projectId));
        } catch (e) {
          toTrpc(e);
        }

        // §6.3 đặt `child_sequencing` trên SUMMARY. Đặt lên task lá thì trường đó không
        // có nghĩa gì và sẽ âm thầm bị bỏ qua — thà từ chối để lỗi lộ ra ngay.
        if (read.loadTaskKind(ctx.db, input.taskUid) !== 'summary') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only a summary row has a parallel/sequential switch.',
          });
        }

        ctx.db.transaction(() => {
          read.setSequencing(ctx.db, input.taskUid, input.mode, ctx.now);
          recordUpdate(
            ctx.db,
            { userId: ctx.user.userId, at: ctx.now },
            'task',
            input.taskUid,
            {},
            { childSequencing: input.mode },
          );
          revalidateAfterEdit(ctx, projectId);
        })();
        return { ok: true as const };
      }),

    /**
     * §10.1 — chạy thử lịch rồi TRẢ VỀ bảng so sánh, KHÔNG ghi gì.
     *
     * "Trước khi ghi kết quả recalculate, hiện bảng so sánh trước/sau... PM xác nhận rồi
     * mới lưu." Chạy trên một BẢN SAO của DB nên dù engine có đổi gì thì DB thật vẫn
     * nguyên. M2 (cùng input ra cùng output) bảo đảm lần chạy thật sau đó ra đúng kết
     * quả vừa xem.
     */
    previewRecalculate: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          scope: z.enum(['project', 'all']).default('project'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          assertCan(
            input.scope === 'all' ? 'recalculate_all' : 'recalculate_project',
            permissionContext(ctx, input.projectId),
          );
        } catch (e) {
          toTrpc(e);
        }
        return previewRecalculate({
          db: ctx.db,
          dbPath: ctx.dbPath,
          projectId: input.projectId,
          scope: input.scope,
          now: ctx.now,
        });
      }),

    recalculate: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          scope: z.enum(['project', 'all']).default('project'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          assertCan(
            input.scope === 'all' ? 'recalculate_all' : 'recalculate_project',
            permissionContext(ctx, input.projectId),
          );
        } catch (e) {
          toTrpc(e);
        }
        // §7.14 — chạy trong worker thread để không chặn API.
        return runSchedulerInWorker({
          dbPath: ctx.dbPath,
          projectId: input.projectId,
          scope: input.scope,
          runId: `ui-${ctx.now}`,
          now: ctx.now,
        });
      }),
  }),

  // ── S3 — Gantt, chỉ xem (N3) ─────────────────────────────────────────────
  gantt: t.router({
    get: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      // Cùng nguồn với S1 (§10.1 cấm client tính lại bất cứ con số nào), nhưng kèm
      // `team_id` và `phase` — §14.2/P9 đòi Gantt lọc được theo team và theo phase.
      return read.loadGanttRows(ctx.db, input.projectId);
    }),
  }),

  // ── S4 — Progress entry ──────────────────────────────────────────────────
  progress: t.router({
    list: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      const perm = permissionContext(ctx, input.projectId);
      try {
        assertCan('view_assigned_project', perm);
      } catch (e) {
        toTrpc(e);
      }
      // Lead chỉ thấy team mình (§10.5 "lọc mặc định"); PM và admin thấy tất.
      const teamFilter = perm.projectRole === 'lead' ? perm.teamId : null;
      return read.loadProgressRows(ctx.db, input.projectId, teamFilter);
    }),

    /** Bảng S4 đầy đủ: dòng + đề xuất của engine + cờ "on track" (§10.5). */
    board: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      const perm = permissionContext(ctx, input.projectId);
      try {
        assertCan('view_assigned_project', perm);
      } catch (e) {
        toTrpc(e);
      }
      const teamFilter = perm.projectRole === 'lead' ? perm.teamId : null;
      return read.loadProgressBoard(ctx.db, input.projectId, teamFilter);
    }),

    save: authed
      .input(
        z.object({
          rows: z
            .array(
              z.object({
                taskUid: z.string().min(1),
                status: z.enum(['not_started', 'in_progress', 'done', 'blocked', 'cancelled']),
                percent: z.number().min(0).max(100),
                actualStart: z.string().nullable(),
                actualEnd: z.string().nullable(),
                blockedNote: z.string().nullable().default(null),
              }),
            )
            .min(1),
        }),
      )
      .mutation(({ ctx, input }) => {
        // QUYỀN trước, DỮ LIỆU sau. Đảo thứ tự thì người không có quyền ghi vẫn nhận
        // được phản hồi validate về task họ không được đụng tới — vừa sai mã lỗi, vừa
        // là một kênh rò rỉ nhỏ.
        for (const row of input.rows) {
          const projectId = read.projectOfTask(ctx.db, row.taskUid);
          if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
          const taskTeam = read.teamOfTask(ctx.db, row.taskUid);
          const perm = permissionContext(ctx, projectId);
          const sameTeam = perm.teamId !== null && perm.teamId === taskTeam;
          try {
            assertCan(sameTeam ? 'enter_progress_own_team' : 'enter_progress_other_team', {
              ...perm,
              sameTeam,
            });
          } catch (e) {
            toTrpc(e);
          }
        }

        // Ràng buộc §10.5 kiểm LẠI ở server. UI đã chặn tại ô, nhưng §10.6 nói rõ
        // "kiểm tra quyền ở server, không chỉ ẩn nút" — với dữ liệu cũng vậy: tRPC là
        // API công khai với bất kỳ ai có phiên hợp lệ.
        const entryCtx = read.loadEntryContext(
          ctx.db,
          input.rows.map((r) => r.taskUid),
        );
        for (const row of input.rows) {
          const meta = entryCtx.get(row.taskUid);
          if (meta === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
          const errors = validateProgressEntry({
            status: row.status,
            percent: row.percent,
            actualStart: row.actualStart,
            actualEnd: row.actualEnd,
            blockedNote: row.blockedNote,
            isMicro: meta.isMicro,
            statusDate: meta.statusDate,
          });
          if (errors.length > 0) {
            const first = errors[0];
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `${row.taskUid}: ${first === undefined ? 'invalid' : first.message}`,
            });
          }
        }

        // §10.5: "Lưu một lần, một transaction, ghi audit_log từng dòng."
        //
        // §8 đòi validate chạy sau mỗi lần lưu progress, và nó chạy TRONG cùng transaction
        // này: lưu hỏng giữa chừng thì cả tiến độ lẫn issue cùng biến mất, không để lại
        // báo cáo về một lần lưu chưa từng xảy ra.
        const touchedProjects = new Set<string>();
        ctx.db.transaction(() => {
          for (const row of input.rows) {
            const projectId = read.projectOfTask(ctx.db, row.taskUid);
            if (projectId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
            touchedProjects.add(projectId);

            const taskTeam = read.teamOfTask(ctx.db, row.taskUid);
            const perm = permissionContext(ctx, projectId);
            const sameTeam = perm.teamId !== null && perm.teamId === taskTeam;

            // Quyền kiểm theo TỪNG DÒNG, không kiểm một lần cho cả lô: một lô có thể
            // trộn task của nhiều team, và lead chỉ được ghi cho team mình (§10.6).
            try {
              assertCan(sameTeam ? 'enter_progress_own_team' : 'enter_progress_other_team', {
                ...perm,
                sameTeam,
              });
            } catch (e) {
              toTrpc(e);
            }

            // Lấy ĐỦ năm trường §10.5 cho phép sửa, không chỉ `status` và `percent`.
            //
            // Trước đây chỉ đọc hai trường, nên lead sửa `actual_start` / `actual_end` —
            // đúng thứ quyết định một task có bị tính là trễ hay không — không để lại
            // dòng nhật ký nào. Đặt alias camelCase để khớp tên khoá với object `after`:
            // lệch tên thì `recordUpdate` coi MỌI trường là đã đổi.
            const before = ctx.db
              .prepare(
                `SELECT status, percent, actual_start AS actualStart, actual_end AS actualEnd,
                        blocked_note AS blockedNote
                 FROM progress WHERE task_uid = ?`,
              )
              .get(row.taskUid) as Record<string, unknown> | undefined;

            read.upsertProgress(ctx.db, {
              taskUid: row.taskUid,
              status: row.status,
              percent: row.percent,
              actualStart: row.actualStart,
              actualEnd: row.actualEnd,
              blockedNote: row.blockedNote,
              updatedBy: ctx.user.userId,
              source: 'ui',
              now: ctx.now,
            });

            recordUpdate(
              ctx.db,
              { userId: ctx.user.userId, at: ctx.now },
              'progress',
              row.taskUid,
              before ?? {},
              {
                status: row.status,
                percent: row.percent,
                actualStart: row.actualStart,
                actualEnd: row.actualEnd,
                blockedNote: row.blockedNote,
              },
            );
          }

          // Một lô có thể trộn task của nhiều dự án, nên validate theo TỪNG dự án đã
          // đụng tới. Chạy một lượt cho cả lô rồi gán chung sẽ ghi issue của dự án này
          // sang dự án kia.
          for (const projectId of [...touchedProjects].sort()) {
            const runId = `progress-${ctx.now}`;
            recordValidationRun(ctx.db, {
              runId,
              projectId,
              detectedAt: ctx.now,
              source: 'progress',
              issues: validateProject(ctx.db, projectId, runId).issues,
            });
          }
        })();
        return { saved: input.rows.length };
      }),
  }),

  // ── EVM (SPI) ────────────────────────────────────────────────────────────
  evm: t.router({
    /**
     * Chỉ số tiến độ so với baseline. `null` khi dự án chưa chốt baseline nào —
     * EVM không có nghĩa nếu chưa có kế hoạch gốc để so.
     */
    get: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          baselineId: z.string().min(1).optional(),
        }),
      )
      .query(({ ctx, input }) => {
        try {
          assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
        } catch (e) {
          toTrpc(e);
        }
        return read.loadEvm(ctx.db, input.projectId, input.baselineId);
      }),

    baselines: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      return baselineRepo.listBaselines(ctx.db, input.projectId);
    }),
  }),

  // ── S6 — Issues ──────────────────────────────────────────────────────────
  // ── S8 — Import (§9) ─────────────────────────────────────────────────────
  //
  // Cho tới trước đây đường DUY NHẤT nạp WBS là `cli import` trên máy chủ. PM không có
  // shell thì không nạp được gì — mà §9.1 nói rõ đầu vào là JSON do AI sinh, tức là thứ
  // PM nhận qua chat rồi dán vào.
  wbsImport: t.router({
    /**
     * Chạy thử rồi vứt bỏ — §10.1 "hiện hậu quả trước khi ghi".
     *
     * Một lần nạp HỎNG vốn đã vô hại (§9.3 rollback). Thứ cần xem trước là lần nạp THÀNH
     * CÔNG với `replace-subtree`: nó xoá sạch cây con của `root_uid` (§9.5), và
     * `ON DELETE CASCADE` kéo theo tiến độ đã nhập — thứ tính lại không được.
     */
    dryRun: authed.input(z.object({ payload: z.unknown() })).mutation(({ ctx, input }) => {
      const target = resolveImportTarget(ctx, input.payload);

      // Đếm thứ sẽ mất TRƯỚC khi chạy thử: sau lượt thử thì mọi thứ đã quay lại như cũ,
      // nhưng ở đây ta cần con số để hiện cho PM.
      const removing =
        target.rootUid === null
          ? null
          : (() => {
              const info = read.subtreeOf(ctx.db, target.rootUid);
              // `subtreeOf` tính CẢ `root_uid`; §9.5 chỉ xoá con cháu nên trừ nó ra.
              return {
                taskCount: Math.max(info.uids.length - 1, 0),
                progressRows: info.progressRows,
              };
            })();

      try {
        const result = dryRunImport(ctx.db, input.payload, {
          runId: `dryrun-${ctx.now}`,
          now: ctx.now,
        });
        return {
          ok: true as const,
          projectCode: target.projectCode,
          mode: target.mode,
          tasksAdded: result.tasksAdded,
          issues: result.report.issues,
          removing,
        };
      } catch (error) {
        return { ok: false as const, ...describeImportFailure(error), removing };
      }
    }),

    /** Nạp thật. PM đã xem bảng ở bước trên rồi mới tới đây. */
    commit: authed.input(z.object({ payload: z.unknown() })).mutation(({ ctx, input }) => {
      const target = resolveImportTarget(ctx, input.payload);
      try {
        const result = importTasks(ctx.db, input.payload, {
          runId: `import-${ctx.now}`,
          now: ctx.now,
        });
        return {
          ok: true as const,
          projectCode: target.projectCode,
          tasksAdded: result.tasksAdded,
          issues: result.report.issues,
        };
      } catch (error) {
        return { ok: false as const, ...describeImportFailure(error) };
      }
    }),
  }),

  // ── S7 — Chốt kỳ (§7.13) ─────────────────────────────────────────────────
  period: t.router({
    /**
     * Ba việc trong MỘT transaction (§7.13): đặt `status_date`, validate, ghi baseline.
     *
     * Có Critical thì KHÔNG chốt — và đó là điểm khác biệt so với mọi đường ghi khác
     * trong router này. Ở chỗ khác, §12.4 cho ghi rồi báo; ở đây §7.13 nói thẳng "dừng,
     * không chốt". Lý do hợp lý: baseline là mốc cam kết, mọi so sánh scope creep về sau
     * dựa vào nó. Chốt một mốc dựng trên dữ liệu hỏng là làm hỏng cả thước đo.
     */
    close: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          statusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          label: z.string().min(1).max(60),
        }),
      )
      .mutation(({ ctx, input }) => {
        try {
          assertCan('close_period', permissionContext(ctx, input.projectId));
        } catch (e) {
          toTrpc(e);
        }

        try {
          const result = closePeriod(ctx.db, {
            projectId: input.projectId,
            statusDate: input.statusDate as never,
            label: input.label,
            takenBy: ctx.user.userId,
            takenAt: ctx.now,
            runId: `close-${ctx.now}`,
            baselineId: `B-${ctx.now}-${input.projectId}`,
          });
          return {
            ok: true as const,
            baselineId: result.baselineId,
            taskCount: result.taskCount,
            issues: result.report.issues,
          };
        } catch (error) {
          if (error instanceof PeriodNotClosedError) {
            // Trả về thay vì ném: PM cần ĐỌC danh sách vấn đề để đi sửa, và một mã lỗi
            // tRPC chỉ mang được một câu.
            return {
              ok: false as const,
              message: 'Cannot close: the project has blocking issues.',
              issues: error.report.issues,
            };
          }
          throw error;
        }
      }),

    /** Baseline đã chốt, mới nhất trước. Bản đã ẩn không hiện (§7.13 không cho xoá). */
    list: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      return baselineRepo.listBaselines(ctx.db, input.projectId);
    }),
  }),

  /**
   * S5 — Resources & calendars (§10.3, toàn cục).
   *
   * §10.6: `manage_resources` là `{pm: false, lead: false}` — CHỈ admin. §10.3 cũng nói
   * "S5 và S9 nằm ngoài phạm vi dự án — thuộc về tổ chức", nên quyền ở đây không gắn với
   * dự án nào: không có `permissionContext(ctx, projectId)` để gọi.
   */
  admin: t.router({
    overview: authed.query(({ ctx }) => {
      requireAdmin(ctx);
      return {
        resources: adminRepo.listResources(ctx.db),
        calendars: adminRepo.listCalendars(ctx.db),
        locations: adminRepo.listLocations(ctx.db),
      };
    }),

    exceptions: authed
      .input(
        z.object({
          calendarId: z.string().min(1).optional(),
          from: z.string().regex(DATE).optional(),
          to: z.string().regex(DATE).optional(),
        }),
      )
      .query(({ ctx, input }) => {
        requireAdmin(ctx);
        return adminRepo.listExceptions(ctx.db, input);
      }),

    saveResource: authed
      .input(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          locationId: z.string().min(1),
          dailyCapacity: z.number().positive().max(2),
          maxParallel: z.number().int().positive().nullable(),
          availableFrom: z.string().regex(DATE).nullable(),
          availableTo: z.string().regex(DATE).nullable(),
          costPerMd: z.number().nonnegative().nullable(),
          roles: z.array(z.string().min(1)).min(1),
          /** `true` = tạo mới. Tách khỏi sửa để không lỡ tay ghi đè một người đang có. */
          create: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => {
        requireAdmin(ctx);
        const { create, ...resource } = input;

        if (input.availableFrom !== null && input.availableTo !== null) {
          if (input.availableFrom > input.availableTo) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Available from is after available to.',
            });
          }
        }

        try {
          if (create) {
            adminRepo.createResource(ctx.db, resource);
          } else if (!adminRepo.updateResource(ctx.db, resource)) {
            throw new TRPCError({ code: 'NOT_FOUND' });
          }
        } catch (error) {
          if (error instanceof adminRepo.ResourceExistsError) {
            throw new TRPCError({ code: 'CONFLICT', message: error.message });
          }
          throw error;
        }

        recordUpdate(
          ctx.db,
          { userId: ctx.user.userId, at: ctx.now },
          'resource',
          input.id,
          {},
          { ...resource, roles: [...resource.roles].sort().join(',') },
        );
        return { ok: true as const };
      }),

    addException: authed
      .input(
        z.object({
          calendarId: z.string().min(1),
          dateFrom: z.string().regex(DATE),
          dateTo: z.string().regex(DATE),
          capacity: z.number().min(0).max(1),
          kind: z.enum(['holiday', 'leave', 'overtime', 'other']),
          note: z.string().nullable(),
        }),
      )
      .mutation(({ ctx, input }) => {
        requireAdmin(ctx);
        if (input.dateFrom > input.dateTo) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateFrom is after dateTo.' });
        }
        return { id: adminRepo.addException(ctx.db, input) };
      }),

    /**
     * Nghỉ phép của MỘT người — không nhận `calendarId`.
     *
     * §5.2 để nghỉ phép cá nhân trong một lịch `scope='resource'` riêng, mà người chưa
     * từng nghỉ thì chưa có lịch đó. Bắt màn hình tự dựng lịch rồi trỏ `calendar_id` là
     * bắt admin học mô hình hai tầng chỉ để gõ "An nghỉ ba ngày". Repo lo phần đó.
     */
    addResourceLeave: authed
      .input(
        z.object({
          resourceId: z.string().min(1),
          dateFrom: z.string().regex(DATE),
          dateTo: z.string().regex(DATE),
          capacity: z.number().min(0).max(1).default(0),
          kind: z.enum(['leave', 'overtime', 'other']).default('leave'),
          note: z.string().nullable(),
        }),
      )
      .mutation(({ ctx, input }) => {
        requireAdmin(ctx);
        if (input.dateFrom > input.dateTo) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateFrom is after dateTo.' });
        }
        try {
          return adminRepo.addResourceLeave(ctx.db, input);
        } catch (error) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'unknown resource',
          });
        }
      }),

    removeException: authed
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => {
        requireAdmin(ctx);
        if (!adminRepo.removeException(ctx.db, input.id)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        return { ok: true as const };
      }),
  }),

  /**
   * S9 — Resource pool xuyên dự án (§10.3, §7.12).
   *
   * §10.6: `view_resource_pool` là `{pm: true, lead: false}` — PM đọc được, lead thì
   * không. Đúng như §10.3 ghi: "Admin, PM đọc".
   *
   * Chỉ đọc. Sửa người và lịch nghỉ nằm ở S5 (admin); màn này trả lời một câu khác: ai
   * đang giữ người nào, và ở đâu đang tranh nhau.
   */
  pool: t.router({
    load: authed
      .input(
        z.object({
          from: z.string().regex(DATE),
          to: z.string().regex(DATE),
          by: z.enum(['day', 'week', 'month']).default('week'),
        }),
      )
      .query(({ ctx, input }) => {
        // Không gắn với dự án nào: pool là toàn cục (§7.12). Vai dự án vì thế không có
        // nghĩa ở đây, và bảng §10.6 cho PM quyền này ở mức tài khoản.
        try {
          assertCan('view_resource_pool', {
            isAdmin: ctx.user.isAdmin,
            projectRole: pmSomewhere(ctx) ? 'pm' : null,
          });
        } catch (e) {
          toTrpc(e);
        }

        const engine = createCalendarEngine(loadCalendarSnapshot(ctx.db));
        try {
          return {
            ...poolLoad({
              spans: mcpRepo.loadPoolSpans(ctx.db, { from: input.from, to: input.to }).map((s) => ({
                resourceId: s.resourceId,
                resourceName: s.resourceName,
                fromDate: unsafeDateOnly(s.fromDate),
                toDate: unsafeDateOnly(s.toDate),
                allocation: s.allocation,
                effortMd: s.effortMd,
                projectId: s.projectId,
                projectCode: s.projectCode,
              })),
              from: unsafeDateOnly(input.from),
              to: unsafeDateOnly(input.to),
              bucket: input.by,
              capacityOn: (resourceId, date) => engine.capacityOn(resourceId, date),
              resources: adminRepo.listResources(ctx.db),
            }),
            projects: mcpRepo.listActiveProjects(ctx.db),
          };
        } catch (error) {
          if (error instanceof LoadWindowTooWideError) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
          }
          throw error;
        }
      }),
  }),

  issues: t.router({
    list: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      return read.loadIssues(ctx.db, input.projectId);
    }),

    /**
     * Lượt validate gần nhất — `null` nếu dự án chưa từng được kiểm.
     *
     * Danh sách rỗng KHÔNG đủ để nói "dự án sạch": chưa ai chạy validate lần nào cũng cho
     * ra rỗng y hệt. Panel cần phân biệt hai câu đó, nên hỏi riêng.
     */
    lastRun: authed.input(z.object({ projectId: z.string().min(1) })).query(({ ctx, input }) => {
      try {
        assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
      } catch (e) {
        toTrpc(e);
      }
      return issueRepo.loadLastValidationRun(ctx.db, input.projectId);
    }),

    /**
     * Lịch sử các lượt validate, mới nhất trước — PM quyết ngày 2026-09-13.
     *
     * Mỗi dòng là một TRẠNG THÁI issue khác nhau, không phải một lần bấm nút: lượt nào
     * cho ra tập issue y hệt lượt trước thì chỉ đẩy `lastAt`. Nhờ vậy `firstAt` trả lời
     * đúng câu "vấn đề này xuất hiện từ bao giờ".
     */
    history: authed
      .input(
        z.object({
          projectId: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(20),
        }),
      )
      .query(({ ctx, input }) => {
        try {
          assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
        } catch (e) {
          toTrpc(e);
        }
        return issueRepo.loadValidationHistory(ctx.db, input.projectId, input.limit);
      }),

    /**
     * Issue của một lượt cũ — xem lại một mốc trong lịch sử.
     *
     * `runPk` là khoá của DÒNG lịch sử, không phải `run_id` của engine: `run_id` không
     * duy nhất (hai lượt trong cùng một mili-giây trùng nhau), nên dùng nó để tra sẽ trộn
     * issue của nhiều lượt.
     *
     * Vẫn nhận `projectId` để kiểm quyền — và để một `runPk` của dự án khác không lọt qua.
     */
    ofRun: authed
      .input(z.object({ projectId: z.string().min(1), runPk: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        try {
          assertCan('view_assigned_project', permissionContext(ctx, input.projectId));
        } catch (e) {
          toTrpc(e);
        }
        const owned = issueRepo
          .loadValidationHistory(ctx.db, input.projectId)
          .some((r) => r.id === input.runPk);
        if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });
        return read.loadIssuesOfRun(ctx.db, input.runPk);
      }),
  }),
});

export type AppRouter = typeof appRouter;
export { t };
