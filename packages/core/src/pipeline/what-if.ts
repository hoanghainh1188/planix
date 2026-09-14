/**
 * `wbs_what_if` — SPEC.md §12.3, quy tắc ở §12.4.
 *
 * > `wbs_what_if` chạy trên bản sao DB trong RAM. **Tuyệt đối không ghi.**
 *
 * ## Bất biến đó được cài vào HÌNH DẠNG hàm, không chỉ vào kỷ luật
 *
 * `runWhatIf` nhận DB thật ở dạng **chỉ đọc** và tự tạo bản sao bên trong. Không có tham
 * số nào cho phép người gọi truyền vào một DB để ghi, nên không có cách nào gọi nhầm.
 *
 * Cách khác — "nhận một DB rồi nhớ đừng ghi vào nó" — dựa vào việc mọi người gọi về sau
 * đều nhớ quy tắc. Với một tool mà AI gọi tự động, nhớ nhầm một lần là sửa dữ liệu thật
 * của một dự án đang chạy, và không có lệnh hoàn tác.
 *
 * `db.serialize()` chụp toàn bộ file thành `Buffer`, `new Database(buffer)` mở nó thành
 * một DB RAM độc lập. Đã kiểm: ghi vào bản sao không đụng gì tới bản gốc.
 *
 * ## Vì sao chạy scheduler thẳng ở đây chứ không qua worker
 *
 * `runSchedulerInWorker` cần `dbPath` để worker mở kết nối riêng. Bản sao nằm trong RAM
 * của tiến trình này nên không có đường dẫn nào để đưa. Chạy thẳng cũng đúng hơn về mặt
 * ý nghĩa: what-if không được để lại gì, kể cả một file tạm.
 */

import Database from 'better-sqlite3';
import type { Db } from '../db/migrate.js';
import { diffBaseline, type BaselineDiff } from '../domain/baseline.js';
import { loadBaselineTasks } from '../db/repo/baseline-repo.js';
import { scheduleProject } from './schedule-project.js';
import { validate } from '../domain/validator.js';
import { loadValidationInput } from '../db/repo/import-repo.js';
import type { ValidationReport } from '../domain/validation-types.js';

/** Một thay đổi tạm thời. Tên trường trùng với tool ghi §12.2 để không phải học hai lần. */
export type WhatIfChange =
  | { readonly kind: 'set_effort'; readonly taskUid: string; readonly effortMd: number }
  | { readonly kind: 'pin_resource'; readonly taskUid: string; readonly resourceId: string | null }
  | {
      readonly kind: 'add_resource';
      readonly resourceId: string;
      readonly name: string;
      readonly roles: readonly string[];
      readonly locationId?: string;
    }
  | { readonly kind: 'remove_resource'; readonly resourceId: string }
  | {
      readonly kind: 'set_dependency';
      readonly predUid: string;
      readonly succUid: string;
      readonly type: 'FS' | 'SS' | 'FF' | 'SF';
      readonly lagDays: number;
    }
  | {
      readonly kind: 'remove_dependency';
      readonly predUid: string;
      readonly succUid: string;
      readonly type: 'FS' | 'SS' | 'FF' | 'SF';
    };

export interface WhatIfResult {
  readonly applied: readonly string[];
  /**
   * Mốc so sánh: lịch sau khi xếp lại mà KHÔNG áp thay đổi nào.
   *
   * Không phải lịch đang lưu trong DB — xem chú thích ở `runWhatIf`.
   */
  readonly before: { readonly projectEnd: string | null; readonly totalMd: number };
  readonly after: { readonly projectEnd: string | null; readonly totalMd: number };
  /** Dương là muộn hơn, âm là sớm hơn. Đếm theo ngày lịch. */
  readonly endShiftDays: number | null;
  readonly diff: BaselineDiff;
  /** Báo cáo §8 của trạng thái GIẢ ĐỊNH — để biết thay đổi có tạo ra vấn đề mới không. */
  readonly validation: ValidationReport;
  /**
   * Ngày kết thúc đang LƯU trong DB, chưa xếp lại.
   *
   * Khác `before.projectEnd` nghĩa là chỉ cần bấm xếp lại — chưa cần thay đổi gì — lịch
   * đã dịch rồi. Tách ra để PM đọc được hai thứ riêng biệt: phần dịch do xếp lại, và
   * phần dịch do chính thay đổi họ đang cân nhắc.
   */
  readonly storedProjectEnd: string | null;
}

export class WhatIfChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatIfChangeError';
  }
}

function applyChange(copy: Db, change: WhatIfChange, now: string): string {
  switch (change.kind) {
    case 'set_effort': {
      const n = copy
        .prepare('UPDATE task SET effort_md = ?, updated_at = ? WHERE uid = ?')
        .run(change.effortMd, now, change.taskUid).changes;
      if (n === 0) throw new WhatIfChangeError(`No task ${change.taskUid}`);
      return `set_effort ${change.taskUid} → ${String(change.effortMd)} MD`;
    }
    case 'pin_resource': {
      const n = copy
        .prepare('UPDATE task SET pinned_resource = ?, updated_at = ? WHERE uid = ?')
        .run(change.resourceId, now, change.taskUid).changes;
      if (n === 0) throw new WhatIfChangeError(`No task ${change.taskUid}`);
      return `pin_resource ${change.taskUid} → ${change.resourceId ?? 'none'}`;
    }
    case 'add_resource': {
      // Địa điểm quyết định lịch nghỉ áp cho người này (§5.4). Không đoán: thiếu thì lấy
      // địa điểm mặc định của dự án, và nói ra trong `applied`.
      const location =
        change.locationId ??
        (copy.prepare('SELECT id FROM location ORDER BY id LIMIT 1').get() as { id: string }).id;
      copy
        .prepare('INSERT INTO resource (id,name,location_id) VALUES (?,?,?)')
        .run(change.resourceId, change.name, location);
      for (const role of change.roles) {
        copy
          .prepare('INSERT INTO resource_role (resource_id,role) VALUES (?,?)')
          .run(change.resourceId, role);
      }
      return `add_resource ${change.resourceId} (${change.roles.join(', ')}) @ ${location}`;
    }
    case 'remove_resource': {
      // Gỡ cả assignment lẫn ghim: để lại một `pinned_resource` trỏ tới người đã biến mất
      // sẽ làm engine ném giữa chừng, và thông điệp lỗi khi đó chẳng nói gì về what-if.
      copy
        .prepare('UPDATE task SET pinned_resource = NULL WHERE pinned_resource = ?')
        .run(change.resourceId);
      copy.prepare('DELETE FROM assignment WHERE resource_id = ?').run(change.resourceId);
      copy.prepare('DELETE FROM resource_role WHERE resource_id = ?').run(change.resourceId);
      const n = copy.prepare('DELETE FROM resource WHERE id = ?').run(change.resourceId).changes;
      if (n === 0) throw new WhatIfChangeError(`No resource ${change.resourceId}`);
      return `remove_resource ${change.resourceId}`;
    }
    case 'set_dependency': {
      copy
        .prepare(
          `INSERT INTO dependency (pred_uid, succ_uid, type, lag_days) VALUES (?,?,?,?)
           ON CONFLICT(pred_uid, succ_uid, type) DO UPDATE SET lag_days = excluded.lag_days`,
        )
        .run(change.predUid, change.succUid, change.type, change.lagDays);
      return `set_dependency ${change.predUid} → ${change.succUid} (${change.type}${change.lagDays === 0 ? '' : `${change.lagDays > 0 ? '+' : ''}${String(change.lagDays)}`})`;
    }
    case 'remove_dependency': {
      const n = copy
        .prepare('DELETE FROM dependency WHERE pred_uid = ? AND succ_uid = ? AND type = ?')
        .run(change.predUid, change.succUid, change.type).changes;
      if (n === 0) {
        throw new WhatIfChangeError(
          `No dependency ${change.predUid} → ${change.succUid} (${change.type})`,
        );
      }
      return `remove_dependency ${change.predUid} → ${change.succUid}`;
    }
  }
}

/**
 * Ảnh chụp DB, đã sửa để mở được trong RAM.
 *
 * `db.serialize()` cho đúng nội dung file, nhưng DB thật chạy **WAL** (§3.1, đặt trong
 * `openDatabase`) và hai byte 18–19 của header SQLite ghi lại điều đó. SQLite **không**
 * dùng WAL cho DB trong RAM, nên mở thẳng ảnh chụp đó sẽ ném `SQLITE_CANTOPEN`.
 *
 * Hai byte ấy là "file format write version" / "read version" trong định dạng file
 * SQLite: `1` = rollback journal, `2` = WAL. Đặt về `1` biến ảnh chụp thành một DB
 * không-WAL, đúng thứ mở được trong RAM. Sửa trên BẢN SAO của buffer, không đụng file.
 *
 * Đây là lỗi chỉ lộ ra trên DB dạng FILE. Mọi test dùng `:memory:`, mà DB trong RAM
 * không bao giờ ở chế độ WAL — nên toàn bộ test xanh trong khi tính năng hỏng hoàn toàn
 * ở môi trường thật. Tìm ra khi chạy thử trên `data/dev.db`.
 */
function inMemoryImageOf(db: Db): Buffer {
  const image = Buffer.from(db.serialize());
  image[18] = 1;
  image[19] = 1;
  return image;
}

function summarise(tasks: ReturnType<typeof loadBaselineTasks>): {
  projectEnd: string | null;
  totalMd: number;
} {
  let projectEnd: string | null = null;
  let totalMd = 0;
  for (const t of tasks) {
    if (t.endDate !== null && (projectEnd === null || t.endDate > projectEnd)) {
      projectEnd = t.endDate;
    }
    totalMd += t.effortMd;
  }
  return { projectEnd, totalMd: Math.round(totalMd * 100) / 100 };
}

function epochDay(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86400000);
}

/**
 * Chạy một kịch bản giả định.
 *
 * `db` chỉ được ĐỌC. Mọi thứ sau `serialize()` xảy ra trên bản sao RAM và biến mất khi
 * hàm trả về.
 */
export function runWhatIf(
  db: Db,
  params: {
    readonly projectId: string;
    readonly changes: readonly WhatIfChange[];
    readonly runId: string;
    readonly now: string;
  },
): WhatIfResult {
  const stored = summarise(loadBaselineTasks(db, params.projectId));

  const copy: Db = new Database(inMemoryImageOf(db));
  try {
    copy.pragma('foreign_keys = ON');

    // Xếp lại MỘT LẦN trước khi áp thay đổi, và lấy ĐÓ làm mốc so sánh.
    //
    // Dùng thẳng lịch đang lưu làm mốc thì sai, và sai một cách âm thầm: lịch đang lưu
    // được tính ở một thời điểm khác, dưới một trạng thái pool nhân sự khác. §7.12 cho
    // các dự án dùng chung người, nên chỗ đã bị dự án kia chiếm có thể đã đổi kể từ lần
    // xếp trước. Đo trên fixture 500 task: một kịch bản KHÔNG thay đổi gì vẫn báo hàng
    // chục task "trượt" — toàn bộ là do xếp lại, không liên quan gì tới câu hỏi PM đặt.
    //
    // Xếp hai lần trên cùng một bản sao nên cả hai lượt nhìn thấy đúng một trạng thái
    // bên ngoài. Phần chênh lệch còn lại vì thế CHỈ do thay đổi sinh ra.
    scheduleProject(copy, {
      projectId: params.projectId,
      runId: `${params.runId}-base`,
      now: params.now,
    });
    const before = loadBaselineTasks(copy, params.projectId);

    const applied: string[] = [];
    // Một transaction cho mọi thay đổi. Nói thẳng: hôm nay nó KHÔNG đổi hành vi nào quan
    // sát được — lỗi thì cả bản sao bị vứt, nên trạng thái nửa vời không ai nhìn thấy. Giữ
    // lại vì nếu sau này có ai cho phép "lỗi một phần vẫn trả kết quả phần còn lại", thiếu
    // nó là bug ngay, và lúc đó không ai nhớ ra phải thêm.
    copy.transaction(() => {
      for (const change of params.changes) {
        applied.push(applyChange(copy, change, params.now));
      }
    })();

    scheduleProject(copy, { projectId: params.projectId, runId: params.runId, now: params.now });
    const after = loadBaselineTasks(copy, params.projectId);

    const beforeSummary = summarise(before);
    const afterSummary = summarise(after);

    return {
      applied,
      before: beforeSummary,
      after: afterSummary,
      endShiftDays:
        beforeSummary.projectEnd === null || afterSummary.projectEnd === null
          ? null
          : epochDay(afterSummary.projectEnd) - epochDay(beforeSummary.projectEnd),
      diff: diffBaseline(before, after),
      validation: validationOf(copy, params.projectId, params.runId),
      storedProjectEnd: stored.projectEnd,
    };
  } finally {
    // Đóng kể cả khi ném: mỗi lời gọi giữ một bản sao toàn bộ DB trong RAM, không đóng là
    // rò từng bản một.
    copy.close();
  }
}

/** Lấy báo cáo §8 của trạng thái GIẢ ĐỊNH, đọc từ chính bản sao. */
function validationOf(copy: Db, projectId: string, runId: string): ValidationReport {
  const input = loadValidationInput(copy, projectId, runId);
  if (input === undefined) {
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
