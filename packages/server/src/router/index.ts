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
import * as importRepo from '@planix/core/db/repo/import-repo.js';
import type { ValidationIssue, ValidationReport } from '@planix/core/domain/validation-types.js';
import { recordValidationRun } from '@planix/core/db/repo/issue-repo.js';
import * as issueRepo from '@planix/core/db/repo/issue-repo.js';
import { moveRejectionMessage } from '@planix/core/domain/move.js';
import { previewRecalculate } from '../scheduler/preview.js';
import { assertCan, ForbiddenError, type PermissionContext } from '../auth/permissions.js';
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

function toTrpc(error: unknown): never {
  if (error instanceof ForbiddenError) {
    throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
  }
  throw error;
}

/**
 * §12.4 — chạy validate ngay sau một lần ghi dependency và trả về phần liên quan.
 *
 * Vì sao trả về chứ không chặn: §12.4 nói "sau mỗi tool ghi, tự động chạy validate và
 * kèm `ValidationReport` vào response". Cạnh vẫn được ghi, kể cả khi nó tạo ra Critical.
 * Chặn ở đây là tự đặt thêm một luật không có trong spec, và nó sẽ khoá PM lại giữa
 * chừng một chuỗi sửa nhiều bước mà trạng thái trung gian nào cũng tạm thời sai.
 *
 * Điều spec KHÔNG nói là phải trả cả rổ: một dự án dở dang có hàng trăm issue chẳng dính
 * gì tới cạnh vừa sửa, và dội hết lên panel thì PM không tìm ra cái mình vừa gây ra. Lọc
 * theo hai đầu của cạnh — cộng C01 vì vòng lặp được gắn vào một đỉnh bất kỳ trên đường đi,
 * không nhất thiết là một trong hai đầu.
 *
 * Đo trên fixture 6.000 task: load + validate hết 5,4 ms, nên chạy mỗi lần ghi không phải
 * thứ cần tối ưu.
 */
/** Chạy validate cho MỘT dự án trên trạng thái DB hiện tại (§8). */
function validateProject(db: Db, projectId: string, runId: string): ValidationReport {
  const project = db
    .prepare('SELECT dependency_max_level FROM project WHERE id = ?')
    .get(projectId) as { dependency_max_level: number } | undefined;
  if (project === undefined) {
    return {
      runId,
      projectId,
      passed: true,
      counts: { critical: 0, major: 0, minor: 0 },
      issues: [],
    };
  }

  return validate({
    runId,
    projectId,
    tasks: importRepo.loadTasks(db, projectId),
    dependencies: importRepo.loadDependencies(db, projectId),
    resources: importRepo.loadResources(db),
    resourceRoles: importRepo.loadResourceRoles(db),
    progress: importRepo.loadProgress(db, projectId),
    dependencyMaxLevel: project.dependency_max_level,
  });
}

function validateDependencyEdit(
  db: Db,
  projectId: string,
  runId: string,
  endpoints: readonly string[],
): ValidationIssue[] {
  const touched = new Set(endpoints);
  return validateProject(db, projectId, runId).issues.filter(
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
        })();
        return { ok: true as const };
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
        try {
          ctx.db.transaction(() => {
            read.setDependency(ctx.db, input);
            recordUpdate(
              ctx.db,
              { userId: ctx.user.userId, at: ctx.now },
              'dependency',
              `${input.predUid}->${input.succUid}`,
              {},
              { type: input.type, lagDays: input.lagDays },
            );
          })();
        } catch (e) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: e instanceof Error ? e.message : 'Cannot set dependency',
            cause: e,
          });
        }
        return {
          ok: true as const,
          issues: validateDependencyEdit(ctx.db, projectId, `dep-${ctx.now}`, [
            input.predUid,
            input.succUid,
          ]),
        };
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
        const removed = read.deleteDependency(ctx.db, input);
        return {
          removed,
          issues: validateDependencyEdit(ctx.db, projectId, `dep-${ctx.now}`, [
            input.predUid,
            input.succUid,
          ]),
        };
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

            const before = ctx.db
              .prepare('SELECT status, percent FROM progress WHERE task_uid = ?')
              .get(row.taskUid) as { status: string; percent: number } | undefined;

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
              { status: row.status, percent: row.percent },
            );
          }

          // Một lô có thể trộn task của nhiều dự án, nên validate theo TỪNG dự án đã
          // đụng tới. Chạy một lượt cho cả lô rồi gán chung sẽ ghi issue của dự án này
          // sang dự án kia.
          for (const projectId of [...touchedProjects].sort()) {
            recordValidationRun(ctx.db, {
              runId: `progress-${ctx.now}`,
              projectId,
              detectedAt: ctx.now,
              issues: validateProject(ctx.db, projectId, `progress-${ctx.now}`).issues,
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
  }),
});

export type AppRouter = typeof appRouter;
export { t };
