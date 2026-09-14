/**
 * Truy vấn cho S5 — Resources & calendars (§10.3, toàn cục, admin).
 *
 * Tách khỏi `calendar-repo.ts` vì phạm vi khác hẳn: file kia phục vụ engine (nạp ảnh
 * chụp lịch để tính), file này phục vụ một màn quản trị. Gộp lại thì mọi lượt xếp lịch
 * phải kéo theo cả đống hàm CRUD mà nó không dùng.
 *
 * Mọi SQL nằm trong `db/repo/` (CLAUDE.md §3), prepared statement, không nối chuỗi.
 */

import type { Db } from '../migrate.js';

export interface AdminResourceRow {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  /** `null` = thừa hưởng hoàn toàn lịch của địa điểm (§5.2). */
  readonly calendarId: string | null;
  readonly dailyCapacity: number;
  readonly maxParallel: number | null;
  readonly availableFrom: string | null;
  readonly availableTo: string | null;
  readonly costPerMd: number | null;
  readonly roles: readonly string[];
}

/**
 * Toàn bộ pool nhân sự, kèm vai.
 *
 * Hai truy vấn rồi ghép trong JS, KHÔNG phải mỗi người một lượt hỏi vai (CLAUDE.md §8
 * cấm N+1). Cũng không JOIN vào một câu: một người nhiều vai sẽ nhân dòng lên.
 */
export function listResources(db: Db): AdminResourceRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, location_id, calendar_id, daily_capacity, max_parallel,
              available_from, available_to, cost_per_md
         FROM resource ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

  const roles = new Map<string, string[]>();
  for (const r of db
    .prepare('SELECT resource_id, role FROM resource_role ORDER BY resource_id, role')
    .all() as Array<{ resource_id: string; role: string }>) {
    const list = roles.get(r.resource_id);
    if (list === undefined) roles.set(r.resource_id, [r.role]);
    else list.push(r.role);
  }

  return rows.map((r) => ({
    id: r['id'] as string,
    name: r['name'] as string,
    locationId: r['location_id'] as string,
    calendarId: (r['calendar_id'] as string | null) ?? null,
    dailyCapacity: r['daily_capacity'] as number,
    maxParallel: (r['max_parallel'] as number | null) ?? null,
    availableFrom: (r['available_from'] as string | null) ?? null,
    availableTo: (r['available_to'] as string | null) ?? null,
    costPerMd: (r['cost_per_md'] as number | null) ?? null,
    roles: roles.get(r['id'] as string) ?? [],
  }));
}

export interface ResourceInput {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  readonly dailyCapacity: number;
  readonly maxParallel: number | null;
  readonly availableFrom: string | null;
  readonly availableTo: string | null;
  readonly costPerMd: number | null;
  readonly roles: readonly string[];
}

export class ResourceExistsError extends Error {
  constructor(id: string) {
    super(`Resource ${id} already exists`);
    this.name = 'ResourceExistsError';
  }
}

export function createResource(db: Db, input: ResourceInput): void {
  const existing = db.prepare('SELECT 1 FROM resource WHERE id = ?').get(input.id);
  if (existing !== undefined) throw new ResourceExistsError(input.id);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO resource
         (id, name, location_id, daily_capacity, max_parallel, available_from, available_to, cost_per_md)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.name,
      input.locationId,
      input.dailyCapacity,
      input.maxParallel,
      input.availableFrom,
      input.availableTo,
      input.costPerMd,
    );
    setResourceRoles(db, input.id, input.roles);
  })();
}

/** Trả `false` khi không có ai mang id đó — người gọi phân biệt được với "đã sửa". */
export function updateResource(db: Db, input: ResourceInput): boolean {
  return db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE resource
            SET name = ?, location_id = ?, daily_capacity = ?, max_parallel = ?,
                available_from = ?, available_to = ?, cost_per_md = ?
          WHERE id = ?`,
      )
      .run(
        input.name,
        input.locationId,
        input.dailyCapacity,
        input.maxParallel,
        input.availableFrom,
        input.availableTo,
        input.costPerMd,
        input.id,
      ).changes;
    if (changed === 0) return false;
    setResourceRoles(db, input.id, input.roles);
    return true;
  })();
}

/** Thay cả tập vai, không chèn thêm: bỏ một vai cũng là một thao tác người ta cần làm. */
function setResourceRoles(db: Db, resourceId: string, roles: readonly string[]): void {
  db.prepare('DELETE FROM resource_role WHERE resource_id = ?').run(resourceId);
  const insert = db.prepare('INSERT INTO resource_role (resource_id, role) VALUES (?, ?)');
  // Sắp và khử trùng: thứ tự dòng trong DB không nên phụ thuộc thứ tự người dùng gõ.
  for (const role of [...new Set(roles)].sort()) insert.run(resourceId, role);
}

export interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly weekPattern: string | null;
  /** Số người dùng lịch này làm lịch cá nhân — để biết xoá có an toàn không. */
  readonly resourceCount: number;
}

export function listCalendars(db: Db): CalendarRow[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.scope, c.week_pattern,
              (SELECT COUNT(*) FROM resource r WHERE r.calendar_id = c.id) AS resource_count
         FROM calendar c ORDER BY c.scope, c.id`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r['id'] as string,
    name: r['name'] as string,
    scope: r['scope'] as string,
    weekPattern: (r['week_pattern'] as string | null) ?? null,
    resourceCount: r['resource_count'] as number,
  }));
}

export interface LocationRow {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly calendarId: string;
}

export function listLocations(db: Db): LocationRow[] {
  const rows = db
    .prepare('SELECT id, name, timezone, calendar_id FROM location ORDER BY id')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r['id'] as string,
    name: r['name'] as string,
    timezone: r['timezone'] as string,
    calendarId: r['calendar_id'] as string,
  }));
}

/** Đúng bốn giá trị `CHECK` của cột cho phép — xem `001_init.sql`. */
export type ExceptionKind = 'holiday' | 'leave' | 'overtime' | 'other';

export interface ExceptionRow {
  readonly id: number;
  readonly calendarId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly capacity: number;
  readonly kind: ExceptionKind;
  readonly note: string | null;
}

export function listExceptions(
  db: Db,
  // `| undefined` tường minh: `exactOptionalPropertyTypes` phân biệt "không có khoá" với
  // "khoá mang undefined", và zod `.optional()` sinh ra đúng dạng thứ hai.
  params: {
    readonly calendarId?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
): ExceptionRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.calendarId !== undefined) {
    where.push('calendar_id = ?');
    args.push(params.calendarId);
  }
  // Giao khoảng, không phải nằm trọn trong: một kỳ nghỉ bắc qua biên cửa sổ vẫn phải hiện.
  if (params.from !== undefined) {
    where.push('date_to >= ?');
    args.push(params.from);
  }
  if (params.to !== undefined) {
    where.push('date_from <= ?');
    args.push(params.to);
  }

  const rows = db
    .prepare(
      `SELECT id, calendar_id, date_from, date_to, capacity, kind, note
         FROM calendar_exception
        ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
        ORDER BY date_from, calendar_id, id`,
    )
    .all(...args) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r['id'] as number,
    calendarId: r['calendar_id'] as string,
    dateFrom: r['date_from'] as string,
    dateTo: r['date_to'] as string,
    capacity: r['capacity'] as number,
    // Ép về union chứ không để `string`: ràng buộc `CHECK` của cột đã chặn mọi giá trị
    // khác ngay từ lúc ghi, nên kiểu rộng hơn chỉ làm lớp trên phải tự hẹp lại.
    kind: r['kind'] as ExceptionKind,
    note: (r['note'] as string | null) ?? null,
  }));
}

export interface ExceptionInput {
  readonly calendarId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly capacity: number;
  readonly kind: ExceptionKind;
  readonly note: string | null;
}

export function addException(db: Db, input: ExceptionInput): number {
  if (input.dateFrom > input.dateTo) {
    throw new Error(`dateFrom ${input.dateFrom} is after dateTo ${input.dateTo}`);
  }
  return Number(
    db
      .prepare(
        `INSERT INTO calendar_exception (calendar_id, date_from, date_to, capacity, kind, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.calendarId, input.dateFrom, input.dateTo, input.capacity, input.kind, input.note)
      .lastInsertRowid,
  );
}

export function removeException(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM calendar_exception WHERE id = ?').run(id).changes > 0;
}

/**
 * Ghi nghỉ phép cho MỘT người — và tự lo phần mô hình mà admin không nên phải biết.
 *
 * §5.2: nghỉ phép cá nhân sống trong một lịch `scope='resource'` gắn vào
 * `resource.calendar_id`. Ai chưa có lịch riêng thì `calendar_id` là `NULL` và họ thừa
 * hưởng nguyên lịch địa điểm — nghĩa là **không có chỗ nào để ghi ngày nghỉ của họ**.
 *
 * Bắt admin tự tạo lịch riêng rồi trỏ `calendar_id` là bắt họ học một mô hình hai tầng
 * chỉ để gõ "An nghỉ từ thứ Hai tới thứ Tư". Nên hàm này tạo lịch riêng khi cần.
 *
 * Lịch riêng sinh ra mang `week_pattern` của lịch địa điểm, không phải một mẫu mặc định:
 * người ở JP nghỉ thứ Bảy Chủ nhật theo lịch JP, và một mẫu cứng `'1111100'` sẽ âm thầm
 * đổi ngày làm việc của họ ngay khi ghi dòng nghỉ phép đầu tiên.
 */
export function addResourceLeave(
  db: Db,
  params: {
    readonly resourceId: string;
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly capacity: number;
    readonly kind: 'leave' | 'overtime' | 'other';
    readonly note: string | null;
  },
): { exceptionId: number; calendarId: string; createdCalendar: boolean } {
  return db.transaction(() => {
    const res = db
      .prepare(
        `SELECT r.calendar_id, r.name, l.calendar_id AS location_calendar
           FROM resource r JOIN location l ON l.id = r.location_id
          WHERE r.id = ?`,
      )
      .get(params.resourceId) as
      { calendar_id: string | null; name: string; location_calendar: string } | undefined;
    if (res === undefined) throw new Error(`Unknown resource: ${params.resourceId}`);

    let calendarId = res.calendar_id;
    let createdCalendar = false;
    if (calendarId === null) {
      calendarId = `CAL-${params.resourceId}`;
      const pattern = db
        .prepare('SELECT week_pattern FROM calendar WHERE id = ?')
        .get(res.location_calendar) as { week_pattern: string | null } | undefined;

      db.prepare(
        'INSERT INTO calendar (id, name, scope, parent_id, week_pattern) VALUES (?, ?, ?, ?, ?)',
      ).run(
        calendarId,
        `${res.name} (personal)`,
        'resource',
        res.location_calendar,
        pattern?.week_pattern ?? null,
      );
      db.prepare('UPDATE resource SET calendar_id = ? WHERE id = ?').run(
        calendarId,
        params.resourceId,
      );
      createdCalendar = true;
    }

    const exceptionId = addException(db, {
      calendarId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      capacity: params.capacity,
      kind: params.kind,
      note: params.note,
    });
    return { exceptionId, calendarId, createdCalendar };
  })();
}
