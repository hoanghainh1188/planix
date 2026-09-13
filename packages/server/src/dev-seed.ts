/**
 * Dựng DB dev có dữ liệu chạy được.
 *
 * §13.3 không cho đăng ký công khai, nên DB rỗng nghĩa là không ai vào được. Script này
 * là đường chính thức để có tài khoản đầu tiên.
 *
 *   npm run seed:dev -- ./data/dev.db
 *
 * KHÔNG dùng cho production: mật khẩu nằm ngay trong mã.
 */

import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { importHolidays } from '@planix/core/db/repo/calendar-repo.js';
import { resolveSeed } from '@planix/core/db/seed/holiday-seed.js';
import { scheduleAllProjects } from '@planix/core/pipeline/schedule-project.js';
import { createUser } from './auth/session.js';

const DEV_EMAIL = 'pm@planix.dev';
const DEV_PASSWORD = 'planix-dev-password';
const ROLES = ['BrSE', 'Dev', 'QA', 'Designer', 'TechLead'];

function buildPayload(
  projectCode: string,
  phases: number,
  modules: number,
  leaves: number,
): unknown {
  const tasks: Array<Record<string, unknown>> = [
    {
      tmp_id: 'root',
      parent_tmp_id: null,
      name: `${projectCode} リニューアル`,
      kind: 'summary',
      child_sequencing: 'sequential',
    },
  ];
  const dependencies: Array<Record<string, unknown>> = [];
  const efforts = [0.25, 0.5, 1, 2, 0.5, 3, 0.25, 1.5];
  let n = 0;

  for (let p = 0; p < phases; p++) {
    const phaseId = `ph${p}`;
    tasks.push({
      tmp_id: phaseId,
      parent_tmp_id: 'root',
      name: ['要件定義', '基本設計', '詳細設計', '実装', 'テスト'][p] ?? `Phase ${p + 1}`,
      kind: 'summary',
      child_sequencing: p % 2 === 0 ? 'sequential' : 'parallel',
    });
    if (p > 0) dependencies.push({ pred: `ph${p - 1}`, succ: phaseId, type: 'FS', lag_days: 0 });

    for (let m = 0; m < modules; m++) {
      const moduleId = `${phaseId}m${m}`;
      tasks.push({
        tmp_id: moduleId,
        parent_tmp_id: phaseId,
        name: `Module ${m + 1}`,
        kind: 'summary',
        child_sequencing: (p + m) % 3 === 0 ? 'sequential' : 'parallel',
      });
      if (m === 1)
        dependencies.push({ pred: `${phaseId}m0`, succ: moduleId, type: 'FS', lag_days: 0 });

      for (let i = 0; i < leaves; i++) {
        tasks.push({
          tmp_id: `t${n}`,
          parent_tmp_id: moduleId,
          name: `タスク ${i + 1}`,
          kind: 'work',
          effort_md: efforts[n % efforts.length] ?? 1,
          role: ROLES[n % ROLES.length] ?? 'Dev',
          phase: `P${p + 1}`,
          module: `mod-${p}-${m}`,
          priority: 300 + (n % 5) * 100,
        });
        n++;
      }
    }
  }
  return { version: '1.0', project_code: projectCode, mode: 'merge', tasks, dependencies };
}

export function seedDev(dbPath: string, now: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  migrate(db, now);

  // Chạy lại trên DB đã có dữ liệu sẽ vỡ ở ràng buộc UNIQUE đầu tiên gặp phải, kèm một
  // thông báo không nói lên điều gì. Dừng sớm và nói thẳng phải làm gì.
  const existing = db.prepare('SELECT COUNT(*) AS n FROM calendar').get() as { n: number };
  if (existing.n > 0) {
    db.close();
    throw new Error(`${dbPath} already has data. Delete the file and run again.`);
  }

  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-JP','JP','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','Viet Nam','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('JP','Japan','Asia/Tokyo','CAL-JP')`,
  ).run();

  // Lễ Nhật có sẵn từ nguồn chính thức; lễ VN còn thiếu Tết nên seed từ chối nạp.
  for (const year of [2025, 2026, 2027]) {
    importHolidays(db, { calendarId: 'CAL-JP', year, entries: resolveSeed('JP', year) });
  }

  for (const [id, code, name, priority] of [
    ['P-UTG', 'UTG', 'UTG リニューアル', 1],
    ['P-GEO', 'GEO', 'GEO 配車システム', 2],
  ] as const) {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,status,start_date,status_date,calendar_id,default_location,created_at)
       VALUES (?,?,?,?,'active','2026-01-05','2026-01-05','CAL-VN','VN',?)`,
    ).run(id, code, name, priority, now);
    db.prepare('INSERT INTO team (id,project_id,name) VALUES (?,?,?)').run(`TM-${code}`, id, 'BE');
  }

  const insRes = db.prepare('INSERT INTO resource (id,name,location_id) VALUES (?,?,?)');
  const insRole = db.prepare(
    'INSERT INTO resource_role (resource_id,role,proficiency) VALUES (?,?,?)',
  );
  const insTeam = db.prepare(
    'INSERT INTO resource_team (resource_id,project_id,team_id) VALUES (?,?,?)',
  );
  const names = [
    'Nguyen A',
    'Tran B',
    'Le C',
    'Pham D',
    'Hoang E',
    'Vu F',
    'Do G',
    'Bui H',
    'Dang I',
    'Ngo J',
  ];
  names.forEach((name, i) => {
    const id = `R-${String(i).padStart(2, '0')}`;
    insRes.run(id, name, i % 4 === 0 ? 'JP' : 'VN');
    insRole.run(id, ROLES[i % ROLES.length] ?? 'Dev', 1);
    insRole.run(id, ROLES[(i + 1) % ROLES.length] ?? 'Dev', 1.2);
    insTeam.run(id, 'P-UTG', 'TM-UTG');
    if (i < 4) insTeam.run(id, 'P-GEO', 'TM-GEO');
  });

  importTasks(db, buildPayload('UTG', 5, 6, 20), { runId: 'seed-utg', now });
  importTasks(db, buildPayload('GEO', 3, 4, 12), { runId: 'seed-geo', now });

  scheduleAllProjects(db, { runId: 'seed-schedule', now, windowDays: 1200 });

  db.close();
}

export async function main(): Promise<void> {
  const dbPath = resolve(process.argv[2] ?? './data/dev.db');
  const now = new Date().toISOString();

  seedDev(dbPath, now);

  const db = openDatabase(dbPath);
  await createUser(db, {
    id: 'U-PM',
    email: DEV_EMAIL,
    name: 'Dev PM',
    password: DEV_PASSWORD,
    isAdmin: true,
    now,
  });
  db.prepare(
    `INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P-UTG','pm')`,
  ).run();
  db.prepare(
    `INSERT INTO user_project (user_id,project_id,role) VALUES ('U-PM','P-GEO','pm')`,
  ).run();
  db.close();

  process.stdout.write(`seeded ${dbPath}\n  sign in: ${DEV_EMAIL} / ${DEV_PASSWORD}\n`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('dev-seed.js')) {
  void main();
}
