/**
 * S5 — Resources & calendars (§10.3).
 *
 * Phần đáng kiểm nhất không phải CRUD mà là `addResourceLeave`: nó phải tự dựng lịch cá
 * nhân theo mô hình hai tầng của §5.2, và phải làm đúng tới mức `capacityOn` của engine
 * nhìn thấy ngày nghỉ. Ghi được một dòng vào bảng mà engine vẫn coi hôm đó là ngày làm
 * thì tính năng này vô dụng — và không ai phát hiện ra cho tới khi lịch sai.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import {
  addException,
  addResourceLeave,
  createResource,
  listCalendars,
  listExceptions,
  listLocations,
  listResources,
  removeException,
  ResourceExistsError,
  updateResource,
} from '../../src/db/repo/admin-repo.js';
import { loadCalendarSnapshot } from '../../src/db/repo/calendar-repo.js';
import { createCalendarEngine } from '../../src/domain/calendar.js';
import { unsafeDateOnly as d } from '../../src/domain/date-only.js';

const AT = '2026-09-14T00:00:00.000Z';
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','JP','Asia/Tokyo','CAL-JP')`,
  ).run();
});
afterEach(() => db.close());

const base = {
  id: 'R-1',
  name: 'An',
  locationId: 'VN',
  dailyCapacity: 1,
  maxParallel: null,
  availableFrom: null,
  availableTo: null,
  costPerMd: null,
  roles: ['Dev'],
};

/** Năng lực engine THẬT SỰ thấy — không phải nội dung bảng. */
function capacity(resourceId: string, date: string): number {
  return createCalendarEngine(loadCalendarSnapshot(db)).capacityOn(resourceId, d(date));
}

describe('nhân sự', () => {
  it('tạo rồi liệt kê, kèm vai đã sắp', () => {
    createResource(db, { ...base, roles: ['QA', 'Dev', 'Dev'] });
    const rows = listResources(db);
    expect(rows).toHaveLength(1);
    // Khử trùng và sắp: thứ tự dòng trong DB không nên phụ thuộc thứ tự người gõ.
    expect(rows[0]?.roles).toEqual(['Dev', 'QA']);
  });

  it('trùng id thì từ chối, không ghi đè người đang có', () => {
    createResource(db, base);
    expect(() => createResource(db, { ...base, name: 'Người khác' })).toThrow(ResourceExistsError);
    expect(listResources(db)[0]?.name).toBe('An');
  });

  it('sửa thay CẢ tập vai — bỏ một vai cũng phải làm được', () => {
    createResource(db, { ...base, roles: ['Dev', 'QA'] });
    expect(updateResource(db, { ...base, roles: ['QA'] })).toBe(true);
    expect(listResources(db)[0]?.roles).toEqual(['QA']);
  });

  it('sửa người không tồn tại trả false, không ném', () => {
    expect(updateResource(db, base)).toBe(false);
  });

  it('liệt kê địa điểm và lịch', () => {
    expect(listLocations(db).map((l) => l.id)).toEqual(['JP', 'VN']);
    expect(listCalendars(db).map((c) => c.id)).toEqual(['CAL-JP', 'CAL-VN']);
  });
});

describe('ngày nghỉ của lịch', () => {
  it('thêm rồi gỡ được, và engine thấy ngay', () => {
    createResource(db, base);
    expect(capacity('R-1', '2026-04-30')).toBe(1);

    const id = addException(db, {
      calendarId: 'CAL-VN',
      dateFrom: '2026-04-30',
      dateTo: '2026-04-30',
      capacity: 0,
      kind: 'holiday',
      note: 'Ngày Chiến thắng',
    });
    expect(capacity('R-1', '2026-04-30')).toBe(0);

    expect(removeException(db, id)).toBe(true);
    expect(capacity('R-1', '2026-04-30')).toBe(1);
    expect(removeException(db, id)).toBe(false);
  });

  it('khoảng đảo ngược thì từ chối', () => {
    expect(() =>
      addException(db, {
        calendarId: 'CAL-VN',
        dateFrom: '2026-05-05',
        dateTo: '2026-05-01',
        capacity: 0,
        kind: 'holiday',
        note: null,
      }),
    ).toThrow();
  });

  /** Lọc theo GIAO khoảng: một kỳ nghỉ bắc qua biên cửa sổ vẫn phải hiện. */
  it('lọc theo cửa sổ lấy cả kỳ nghỉ bắc ngang biên', () => {
    addException(db, {
      calendarId: 'CAL-VN',
      dateFrom: '2026-02-14',
      dateTo: '2026-02-20',
      capacity: 0,
      kind: 'holiday',
      note: 'Tết',
    });
    // Cửa sổ chỉ chạm hai ngày cuối của kỳ nghỉ.
    expect(listExceptions(db, { from: '2026-02-19', to: '2026-02-25' })).toHaveLength(1);
    expect(listExceptions(db, { from: '2026-03-01', to: '2026-03-05' })).toHaveLength(0);
  });
});

describe('nghỉ phép cá nhân — mô hình hai tầng §5.2', () => {
  /**
   * Ca quan trọng nhất của file.
   *
   * Người chưa có lịch riêng thì `calendar_id` là `NULL` và họ thừa hưởng nguyên lịch
   * địa điểm — tức là KHÔNG CÓ CHỖ NÀO để ghi ngày nghỉ của họ. Hàm phải tự dựng lịch
   * riêng, và phải dựng đúng tới mức engine nhìn thấy.
   */
  it('người chưa có lịch riêng: tự tạo, và engine thấy ngày nghỉ', () => {
    createResource(db, base);
    expect(listResources(db)[0]?.calendarId).toBeNull();
    expect(capacity('R-1', '2026-03-04')).toBe(1);

    const out = addResourceLeave(db, {
      resourceId: 'R-1',
      dateFrom: '2026-03-02',
      dateTo: '2026-03-04',
      capacity: 0,
      kind: 'leave',
      note: 'nghỉ phép',
    });

    expect(out.createdCalendar).toBe(true);
    expect(listResources(db)[0]?.calendarId).toBe(out.calendarId);
    // Điều duy nhất thật sự quan trọng: ENGINE thấy.
    expect(capacity('R-1', '2026-03-04')).toBe(0);
    expect(capacity('R-1', '2026-03-05')).toBe(1);
  });

  it('lần nghỉ thứ hai KHÔNG tạo thêm lịch nữa', () => {
    createResource(db, base);
    const first = addResourceLeave(db, {
      resourceId: 'R-1',
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02',
      capacity: 0,
      kind: 'leave',
      note: null,
    });
    const second = addResourceLeave(db, {
      resourceId: 'R-1',
      dateFrom: '2026-04-06',
      dateTo: '2026-04-06',
      capacity: 0,
      kind: 'leave',
      note: null,
    });
    expect(second.createdCalendar).toBe(false);
    expect(second.calendarId).toBe(first.calendarId);
    expect(listCalendars(db).filter((c) => c.scope === 'resource')).toHaveLength(1);
  });

  /**
   * Lịch riêng phải mang `week_pattern` của ĐỊA ĐIỂM, không phải một mẫu cứng.
   *
   * Nếu dựng bằng `'1111100'` cố định thì với một địa điểm có mẫu tuần khác, việc ghi
   * dòng nghỉ phép ĐẦU TIÊN sẽ âm thầm đổi luôn ngày làm việc của người đó — một thay
   * đổi không ai yêu cầu và không ai nhìn thấy.
   */
  it('lịch riêng thừa hưởng mẫu tuần của địa điểm', () => {
    // JP ở đây làm cả thứ Bảy: mẫu khác mặc định.
    db.prepare(`UPDATE calendar SET week_pattern = '1111110' WHERE id = 'CAL-JP'`).run();
    createResource(db, { ...base, id: 'R-JP', locationId: 'JP' });
    expect(capacity('R-JP', '2026-03-07')).toBe(1); // thứ Bảy, vẫn làm

    addResourceLeave(db, {
      resourceId: 'R-JP',
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02',
      capacity: 0,
      kind: 'leave',
      note: null,
    });

    // Thứ Bảy KHÔNG được biến thành ngày nghỉ chỉ vì vừa ghi một dòng nghỉ phép.
    expect(capacity('R-JP', '2026-03-07')).toBe(1);
    expect(capacity('R-JP', '2026-03-02')).toBe(0);
  });

  it('người không tồn tại thì ném, không tạo lịch mồ côi', () => {
    expect(() =>
      addResourceLeave(db, {
        resourceId: 'R-KHONG-CO',
        dateFrom: '2026-03-02',
        dateTo: '2026-03-02',
        capacity: 0,
        kind: 'leave',
        note: null,
      }),
    ).toThrow();
    expect(listCalendars(db).filter((c) => c.scope === 'resource')).toHaveLength(0);
  });

  /** §4 của CLAUDE.md đòi đúng tình huống này trong fixture: lễ VN chồng nghỉ phép. */
  it('lễ địa điểm chồng nghỉ phép cá nhân: vẫn là ngày nghỉ', () => {
    createResource(db, base);
    addException(db, {
      calendarId: 'CAL-VN',
      dateFrom: '2026-04-30',
      dateTo: '2026-04-30',
      capacity: 0,
      kind: 'holiday',
      note: 'Ngày Chiến thắng',
    });
    addResourceLeave(db, {
      resourceId: 'R-1',
      dateFrom: '2026-04-30',
      dateTo: '2026-05-04',
      capacity: 0,
      kind: 'leave',
      note: 'nối lễ',
    });

    expect(capacity('R-1', '2026-04-30')).toBe(0);
    expect(capacity('R-1', '2026-05-04')).toBe(0);
    expect(capacity('R-1', '2026-05-05')).toBe(1);
  });
});
