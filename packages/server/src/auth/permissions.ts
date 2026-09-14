/**
 * Phân quyền — SPEC.md §10.6.
 *
 * Bảng §10.6 chép nguyên vào đây thành dữ liệu, không rải if/else khắp router. Rải ra
 * thì không ai đối chiếu được với spec, và một ô sai sẽ lẫn vào giữa hàng trăm dòng.
 *
 * §10.6 chốt: **kiểm tra quyền ở server, không chỉ ẩn nút trên UI.** Hàm này là hàm
 * thuần; router gọi nó, UI chỉ dùng để quyết định hiện hay ẩn.
 *
 * Quyền gắn với cặp `(user, project)` qua `user_project`. `is_admin` nằm ở `app_user`,
 * nên một người có thể là admin toàn hệ thống, hoặc PM dự án A và lead dự án B.
 */

export type Action =
  | 'view_assigned_project'
  | 'view_other_project'
  | 'edit_wbs'
  | 'enter_progress_own_team'
  | 'enter_progress_other_team'
  | 'recalculate_project'
  | 'recalculate_all'
  | 'close_period'
  | 'export_report'
  | 'import_from_ai'
  | 'manage_resources'
  | 'create_project'
  | 'view_resource_pool';

/** Vai trong MỘT dự án. `null` = người này không được gán vào dự án đang xét. */
export type ProjectRole = 'pm' | 'lead' | 'viewer' | null;

export interface PermissionContext {
  readonly isAdmin: boolean;
  readonly projectRole: ProjectRole;
  /** Chỉ có nghĩa với hai hành động nhập tiến độ. */
  readonly sameTeam?: boolean;
  /** Chỉ có nghĩa với `export_report`. §10.6 cho lead bản `full`. */
  readonly reportKind?: 'full' | 'summary' | 'resource';
}

/** Bảng §10.6, chép nguyên. Cột `viewer` không có trong spec — xem ghi chú dưới. */
const TABLE: Record<Action, { pm: boolean; lead: boolean }> = {
  view_assigned_project: { pm: true, lead: true },
  view_other_project: { pm: false, lead: false },
  // Ô này có một bản chép tay ở `packages/web/src/app/App.tsx` (`canEditWbs`) để ẩn nút
  // sửa cây. Đổi ở đây thì sửa cả ở đó — server vẫn chặn đúng, nhưng UI sẽ mời người dùng
  // làm việc họ không làm được, hoặc giấu việc họ được làm.
  edit_wbs: { pm: true, lead: false },
  enter_progress_own_team: { pm: true, lead: true },
  enter_progress_other_team: { pm: true, lead: false },
  recalculate_project: { pm: true, lead: false },
  // §10.6 ghi rõ lý do: lệnh này đụng vào lịch MỌI dự án.
  recalculate_all: { pm: false, lead: false },
  close_period: { pm: true, lead: false },
  export_report: { pm: true, lead: true },
  import_from_ai: { pm: true, lead: false },
  // §10.6: dữ liệu chung, sửa là ảnh hưởng mọi dự án.
  manage_resources: { pm: false, lead: false },
  create_project: { pm: false, lead: false },
  view_resource_pool: { pm: true, lead: false },
};

/**
 * `viewer` không có trong bảng §10.6 dù `user_project.role` cho phép giá trị đó (§4.2).
 *
 * Mặc định CHỈ ĐỌC: xem được dự án được gán, không làm gì khác. Đoán rộng hơn ở đây là
 * cấp quyền mà spec chưa từng cấp.
 */
const VIEWER_ALLOWED: ReadonlySet<Action> = new Set<Action>(['view_assigned_project']);

export function can(action: Action, ctx: PermissionContext): boolean {
  // Admin toàn quyền — mọi ô cột Admin trong §10.6 đều ✅.
  if (ctx.isAdmin) return true;

  // Không được gán vào dự án thì không thấy gì. §10.6: "Xem dự án khác" là ❌ với cả
  // PM lẫn lead.
  if (ctx.projectRole === null) return false;

  if (ctx.projectRole === 'viewer') return VIEWER_ALLOWED.has(action);

  const row = TABLE[action];
  const allowed = ctx.projectRole === 'pm' ? row.pm : row.lead;
  if (!allowed) return false;

  // Hai tinh chỉnh mà bảng ghi trong ngoặc.
  if (action === 'enter_progress_own_team' && ctx.projectRole === 'lead') {
    // Lead chỉ nhập cho team mình. Thiếu thông tin team thì TỪ CHỐI, không đoán.
    return ctx.sameTeam === true;
  }
  if (action === 'export_report' && ctx.projectRole === 'lead') {
    // §10.6 ghi "✅ (bản full)". Bản `summary` đi thẳng tới khách Nhật nên không mở
    // cho lead; bản `resource` là ma trận nhân sự toàn dự án.
    return ctx.reportKind === 'full';
  }

  return true;
}

/** Ném thay vì trả false — dùng ở biên router để không ai quên kiểm giá trị trả về. */
export class ForbiddenError extends Error {
  readonly action: Action;
  constructor(action: Action) {
    super(`Forbidden: ${action}`);
    this.name = 'ForbiddenError';
    this.action = action;
  }
}

export function assertCan(action: Action, ctx: PermissionContext): void {
  if (!can(action, ctx)) throw new ForbiddenError(action);
}
