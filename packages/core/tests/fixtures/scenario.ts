/**
 * Dựng bối cảnh quanh fixture — CLAUDE.md §4 "Fixture phải có".
 *
 * Payload import (§9.2) chỉ chứa cây task và dependency: §9.1 cấm AI gửi ngày tháng,
 * tên người hay `wbs_code`. Nên các tình huống §4 đòi — task huỷ giữa chuỗi, người làm
 * nhiều dự án, lễ chồng nghỉ phép, `pinned_resource` gây quá tải — phải dựng bằng dữ
 * liệu quanh nó, không nhét vào payload được.
 *
 * Mọi thứ ở đây tất định: không random, không đọc đồng hồ.
 */

import type { Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { ROLES } from './generate.js';

export const SCENARIO_AT = '2026-09-13T00:00:00.000Z';
export const PROJECT_START = '2026-01-05';

export interface ScenarioHandles {
  /** Người làm CẢ HAI dự án — §4 đòi tình huống này. */
  readonly sharedResourceId: string;
  /** Ngày vừa là lễ VN vừa là ngày nghỉ phép của `sharedResourceId`. */
  readonly overlappedHolidayDate: string;
  /** Task bị huỷ nằm GIỮA một chuỗi FS, để kiểm bắc cầu §6.5. */
  readonly cancelledMidChainUid: string;
  /** Task bị ghim vào người KHÔNG có role đó, để kiểm `J01` và N4. */
  readonly pinnedOverloadUid: string;
  readonly pinnedResourceId: string;
  /** Role của task bị ghim — người được ghim cố ý không giữ role này. */
  readonly pinnedRole: string;
}

/**
 * Nhân sự dùng chung hai dự án.
 *
 * Mỗi người giữ hai role: pool một-role-một-người sẽ hết năng lực trước khi chạm tới
 * các tình huống cần test, và khi đó test đỏ vì lý do không liên quan.
 */
function seedPeople(db: Db, count: number): string[] {
  const ids: string[] = [];
  const insRes = db.prepare(
    'INSERT INTO resource (id,name,location_id,daily_capacity) VALUES (?,?,?,1)',
  );
  const insRole = db.prepare(
    'INSERT INTO resource_role (resource_id,role,proficiency) VALUES (?,?,?)',
  );
  for (let i = 0; i < count; i++) {
    const id = `R-${String(i).padStart(2, '0')}`;
    ids.push(id);
    insRes.run(id, `Member ${i}`, 'VN');
    insRole.run(id, ROLES[i % ROLES.length] ?? 'Dev', 1);
    insRole.run(id, ROLES[(i + 1) % ROLES.length] ?? 'Dev', 1.2);
  }
  return ids;
}

function seedProject(db: Db, id: string, code: string, priority: number): void {
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES (?,?,?,?,?,?,'CAL-VN','VN',?)`,
  ).run(id, code, code, priority, PROJECT_START, PROJECT_START, SCENARIO_AT);
  db.prepare('INSERT INTO team (id,project_id,name) VALUES (?,?,?)').run(`TM-${code}`, id, 'BE');
}

export interface BuildScenarioOptions {
  readonly primaryPayload: unknown;
  readonly secondaryPayload: unknown;
  readonly resourceCount?: number;
}

/**
 * Dựng đủ bối cảnh §4 quanh hai payload đã sinh.
 *
 * Trả về các "tay cầm" để test khẳng định đúng thứ mình muốn, thay vì đoán uid.
 */
export function buildScenario(db: Db, options: BuildScenarioOptions): ScenarioHandles {
  const resourceCount = options.resourceCount ?? 30;

  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();

  const people = seedPeople(db, resourceCount);
  const sharedResourceId = people[0] ?? 'R-00';

  seedProject(db, 'P-MAIN', 'UTG', 1);
  seedProject(db, 'P-SIDE', 'GEO', 2);

  // §4 — người làm NHIỀU dự án: cùng một resource nằm trong team của cả hai.
  db.prepare('INSERT INTO resource_team (resource_id,project_id,team_id) VALUES (?,?,?)').run(
    sharedResourceId,
    'P-MAIN',
    'TM-UTG',
  );
  db.prepare('INSERT INTO resource_team (resource_id,project_id,team_id) VALUES (?,?,?)').run(
    sharedResourceId,
    'P-SIDE',
    'TM-GEO',
  );

  // §4 — lễ VN CHỒNG nghỉ phép cá nhân.
  //
  // 2026-04-30 là lễ Giải phóng. Thêm lịch cá nhân cho người dùng chung, rồi đặt nghỉ
  // phép đúng ngày đó. §5.2 nói exception cá nhân ghi đè location, nên trường hợp này
  // kiểm đúng chỗ hai lớp chồng nhau chứ không phải chỉ một lớp.
  const overlappedHolidayDate = '2026-04-30';
  db.prepare(
    `INSERT INTO calendar (id,name,scope,parent_id,week_pattern)
     VALUES ('CAL-SHARED','Lich ca nhan','resource','CAL-VN',NULL)`,
  ).run();
  db.prepare('UPDATE resource SET calendar_id = ? WHERE id = ?').run(
    'CAL-SHARED',
    sharedResourceId,
  );
  db.prepare(
    `INSERT INTO calendar_exception (calendar_id,date_from,date_to,capacity,kind,note)
     VALUES ('CAL-VN',?,?,0,'holiday','Ngay Chien thang')`,
  ).run(overlappedHolidayDate, overlappedHolidayDate);
  db.prepare(
    `INSERT INTO calendar_exception (calendar_id,date_from,date_to,capacity,kind,note)
     VALUES ('CAL-SHARED',?,?,0,'leave','Nghi phep chong le')`,
  ).run(overlappedHolidayDate, overlappedHolidayDate);

  importTasks(db, options.primaryPayload, { runId: 'SCN-1', now: SCENARIO_AT });
  importTasks(db, options.secondaryPayload, { runId: 'SCN-2', now: SCENARIO_AT });

  // §4 — task bị huỷ GIỮA một chuỗi FS, để §6.5 có gì mà bắc cầu.
  //
  // Dựng chuỗi tường minh a -> b -> c trên ba task lá cùng cha, rồi huỷ b.
  // Ba lá phải CÙNG CHA: §6.3 chỉ cho phép cạnh tường minh giữa anh em, và cạnh sâu mà
  // khác cha sẽ dính C12 (xem docs/decisions/2026-09-13-c12-vs-sibling-edges.md).
  const chainParent = db
    .prepare(
      `SELECT parent_uid FROM task
       WHERE project_id = 'P-MAIN' AND kind = 'work' AND parent_uid IS NOT NULL
       GROUP BY parent_uid HAVING COUNT(*) >= 3
       ORDER BY parent_uid LIMIT 1`,
    )
    .get() as { parent_uid: string } | undefined;

  const chain =
    chainParent === undefined
      ? []
      : (db
          .prepare(
            `SELECT uid FROM task WHERE parent_uid = ? AND kind = 'work' ORDER BY uid LIMIT 3`,
          )
          .all(chainParent.parent_uid) as Array<{ uid: string }>);
  const [a, b, c] = chain.map((r) => r.uid);
  if (a !== undefined && b !== undefined && c !== undefined) {
    const insDep = db.prepare(
      'INSERT OR IGNORE INTO dependency (pred_uid,succ_uid,type,lag_days) VALUES (?,?,?,?)',
    );
    insDep.run(a, b, 'FS', 1);
    insDep.run(b, c, 'FS', 2);
    db.prepare(
      `INSERT INTO progress (task_uid,status,percent,updated_at) VALUES (?,'cancelled',0,?)`,
    ).run(b, SCENARIO_AT);
  }

  // §4 — `pinned_resource` gây xung đột.
  //
  // Dùng người KHÁC `sharedResourceId`: ghim vào cùng người sẽ làm tình huống "quá tải do
  // pin" đè lên tình huống "dùng chung hai dự án", và test không còn phân biệt được cái
  // nào gây ra cái gì.
  //
  // Ghim vào người KHÔNG giữ role của task, thay vì chờ họ kín lịch: đường này tất định,
  // không phụ thuộc độ rộng cửa sổ hay tải ngẫu nhiên của fixture. Nó kiểm đúng điều N4
  // nói — engine tôn trọng pin tuyệt đối và báo `J01`, KHÔNG tự đổi người.
  const pinnedRole = 'Designer';
  const pinnedResourceId =
    people.find((id) => {
      const holds = db
        .prepare('SELECT 1 FROM resource_role WHERE resource_id = ? AND role = ?')
        .get(id, pinnedRole);
      return id !== sharedResourceId && holds === undefined;
    }) ??
    people[1] ??
    'R-01';

  const pinnedTask = db
    .prepare(
      `SELECT uid FROM task WHERE project_id = 'P-MAIN' AND kind = 'work' ORDER BY uid DESC LIMIT 1`,
    )
    .get() as { uid: string } | undefined;
  if (pinnedTask !== undefined) {
    db.prepare('UPDATE task SET pinned_resource = ?, role = ? WHERE uid = ?').run(
      pinnedResourceId,
      pinnedRole,
      pinnedTask.uid,
    );
  }

  return {
    sharedResourceId,
    overlappedHolidayDate,
    cancelledMidChainUid: b ?? '',
    pinnedOverloadUid: pinnedTask?.uid ?? '',
    pinnedResourceId,
    pinnedRole,
  };
}
