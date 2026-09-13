import { describe, expect, it } from 'vitest';
import {
  assertCan,
  can,
  ForbiddenError,
  type Action,
  type PermissionContext,
} from './permissions.js';

const admin = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  isAdmin: true,
  projectRole: 'pm',
  ...over,
});
const pm = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  isAdmin: false,
  projectRole: 'pm',
  ...over,
});
const lead = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  isAdmin: false,
  projectRole: 'lead',
  ...over,
});

/**
 * Bảng §10.6 chép nguyên vào test, ĐỘC LẬP với bảng trong code.
 *
 * Nếu chỉ import bảng từ code rồi so với chính nó thì test luôn xanh dù bảng sai. Chép
 * lại từ spec là cách duy nhất để test nói được điều gì.
 */
const SPEC_TABLE: Array<[Action, boolean, boolean, boolean]> = [
  // [hành động, admin, pm, lead]
  ['view_assigned_project', true, true, true],
  ['view_other_project', true, false, false],
  ['edit_wbs', true, true, false],
  ['enter_progress_own_team', true, true, true],
  ['enter_progress_other_team', true, true, false],
  ['recalculate_project', true, true, false],
  ['recalculate_all', true, false, false],
  ['close_period', true, true, false],
  ['export_report', true, true, true],
  ['import_from_ai', true, true, false],
  ['manage_resources', true, false, false],
  ['create_project', true, false, false],
  ['view_resource_pool', true, true, false],
];

describe('§10.6 — từng ô trong bảng (§14.2 P7)', () => {
  it('bảng phủ đủ 13 hành động', () => {
    expect(SPEC_TABLE).toHaveLength(13);
  });

  it.each(SPEC_TABLE)('%s: admin = %s, pm = %s, lead = %s', (action, a, p, l) => {
    // Lead can them ngu canh cho hai o co ghi chu trong ngoac.
    const leadCtx = lead({ sameTeam: true, reportKind: 'full' });
    expect(can(action, admin())).toBe(a);
    expect(can(action, pm())).toBe(p);
    expect(can(action, leadCtx)).toBe(l);
  });
});

describe('§10.6 — hai tinh chỉnh ghi trong ngoặc', () => {
  it('lead chỉ nhập tiến độ cho team MÌNH', () => {
    expect(can('enter_progress_own_team', lead({ sameTeam: true }))).toBe(true);
    expect(can('enter_progress_own_team', lead({ sameTeam: false }))).toBe(false);
  });

  it('thiếu thông tin team thì TỪ CHỐI, không đoán', () => {
    expect(can('enter_progress_own_team', lead())).toBe(false);
  });

  it('PM nhập được cho mọi team, không cần sameTeam', () => {
    expect(can('enter_progress_own_team', pm())).toBe(true);
    expect(can('enter_progress_other_team', pm())).toBe(true);
  });

  it('lead chỉ xuất được bản full, không xuất bản summary gửi khách', () => {
    expect(can('export_report', lead({ reportKind: 'full' }))).toBe(true);
    expect(can('export_report', lead({ reportKind: 'summary' }))).toBe(false);
    expect(can('export_report', lead({ reportKind: 'resource' }))).toBe(false);
  });

  it('PM xuất được mọi bản', () => {
    for (const kind of ['full', 'summary', 'resource'] as const) {
      expect(can('export_report', pm({ reportKind: kind }))).toBe(true);
    }
  });
});

describe('§10.6 — không được gán vào dự án', () => {
  it('không thấy gì, kể cả hành động ai cũng làm được', () => {
    const stranger: PermissionContext = { isAdmin: false, projectRole: null };
    for (const [action] of SPEC_TABLE) {
      expect(can(action, stranger)).toBe(false);
    }
  });

  it('admin vẫn xem được dự án không được gán — §10.6 "Xem dự án khác" là ✅', () => {
    expect(can('view_other_project', { isAdmin: true, projectRole: null })).toBe(true);
  });
});

describe('viewer — vai có trong §4.2 nhưng không có trong bảng §10.6', () => {
  const viewer: PermissionContext = { isAdmin: false, projectRole: 'viewer' };

  it('chỉ xem được dự án được gán', () => {
    expect(can('view_assigned_project', viewer)).toBe(true);
  });

  it('không làm được gì khác — đoán rộng hơn là cấp quyền spec chưa từng cấp', () => {
    for (const [action] of SPEC_TABLE) {
      if (action === 'view_assigned_project') continue;
      expect(can(action, viewer)).toBe(false);
    }
  });
});

describe('assertCan', () => {
  it('im lặng khi được phép', () => {
    expect(() => assertCan('edit_wbs', pm())).not.toThrow();
  });

  it('ném ForbiddenError kèm tên hành động khi bị cấm', () => {
    expect(() => assertCan('recalculate_all', pm())).toThrow(ForbiddenError);
    try {
      assertCan('recalculate_all', pm());
    } catch (e) {
      expect((e as ForbiddenError).action).toBe('recalculate_all');
    }
  });
});
