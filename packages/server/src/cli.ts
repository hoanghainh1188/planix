/**
 * Công cụ dòng lệnh cho quản trị — đường DUY NHẤT để dựng một DB dùng thật.
 *
 * Vì sao cần: §13.3 cấm đăng ký công khai, và cho tới trước file này thì cách duy nhất
 * để có tài khoản là `dev-seed` — thứ tạo dữ liệu demo kèm một mật khẩu nằm ngay trong
 * mã nguồn. Chạy thật bằng đường đó nghĩa là ai đọc repo cũng đăng nhập được.
 *
 * Mật khẩu đọc từ STDIN, không bao giờ từ tham số dòng lệnh: tham số nằm lại trong lịch
 * sử shell và hiện ra với mọi tiến trình khác qua `ps`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate, openDatabase, type Db } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { importHolidays } from '@planix/core/db/repo/calendar-repo.js';
import { availableYears, resolveSeed } from '@planix/core/db/seed/holiday-seed.js';
import { createUser } from './auth/session.js';

const USAGE = `planix admin

  create-user   --email <email> --name <name> [--admin]
                Mật khẩu đọc từ stdin:  echo -n 'matkhau' | planix create-user ...

  bootstrap     Dựng lịch VN/JP và địa điểm, nạp sẵn lễ Nhật từ nguồn chính thức.
                Chạy MỘT lần trên DB trống, trước mọi thứ khác.

  add-resource  --id <id> --name <name> --location <VN|JP> --roles <BrSE,Dev,...>
                [--max-parallel <n>]

  create-project --code <CODE> --name <name> --start <YYYY-MM-DD>
                 [--calendar <id>] [--location <id>] [--priority <n>]

  grant         --email <email> --project <CODE> --role <pm|lead|viewer> [--team <id>]
                Gán người vào dự án (§10.6). Admin thấy mọi dự án nên không cần gán.

  import        --project <CODE> --file <tasks.json>
                Nạp danh sách task theo §9.2. Có Critical thì từ chối cả file.

  backup        --out <file.db>
                Ảnh chụp nhất quán, an toàn cả khi server đang chạy (§13.2).

Biến môi trường:
  PLANIX_DB     đường dẫn file SQLite (mặc định ./data/project.db)
`;

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function required(argv: readonly string[], name: string): string {
  const value = arg(argv, name);
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Thiếu --${name}`);
  }
  return value;
}

/** Đọc hết stdin. Dùng cho mật khẩu để nó không lọt vào `ps` hay lịch sử shell. */
async function readStdin(): Promise<string> {
  let text = '';
  // Đặt encoding rồi gom chuỗi: tránh phải ép kiểu Buffer, mà mật khẩu vốn là văn bản.
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += String(chunk);
  return text.trim();
}

function open(now: string): Db {
  const path = resolve(process.env['PLANIX_DB'] ?? './data/project.db');
  const db = openDatabase(path);
  // Đồng hồ đọc ở biên rồi truyền vào, không để core tự đọc (N2).
  migrate(db, now);
  return db;
}

export async function run(argv: readonly string[], now: string): Promise<string> {
  const command = argv[0];

  if (command === undefined || command === 'help' || command === '--help') {
    return USAGE;
  }

  if (command === 'create-user') {
    const email = required(argv, 'email');
    const name = required(argv, 'name');
    const isAdmin = argv.includes('--admin');

    const password = await readStdin();
    if (password.length < 12) {
      // Không có luật độ dài trong spec, nhưng §13.3 đặt argon2id và giới hạn đăng nhập
      // — đặt một mật khẩu 4 ký tự sau ngần ấy công sức thì vô nghĩa.
      throw new Error('Mật khẩu phải từ 12 ký tự. Đọc từ stdin, không phải tham số.');
    }

    const db = open(now);
    try {
      const id = `U-${randomUUID().slice(0, 8)}`;
      await createUser(db, { id, email, name, password, isAdmin, now });
      return `Đã tạo ${isAdmin ? 'admin' : 'user'} ${email} (${id})`;
    } finally {
      db.close();
    }
  }

  if (command === 'bootstrap') {
    const db = open(now);
    try {
      // `INSERT OR IGNORE` để chạy lại lần hai không hỏng — người ta sẽ chạy lại.
      const cal = db.prepare(
        'INSERT OR IGNORE INTO calendar (id,name,scope,week_pattern) VALUES (?,?,?,?)',
      );
      const loc = db.prepare(
        'INSERT OR IGNORE INTO location (id,name,timezone,calendar_id) VALUES (?,?,?,?)',
      );
      const lines: string[] = [];

      db.transaction(() => {
        cal.run('CAL-VN', 'Viet Nam', 'location', '1111100');
        cal.run('CAL-JP', 'Japan', 'location', '1111100');
        loc.run('VN', 'Viet Nam', 'Asia/Ho_Chi_Minh', 'CAL-VN');
        loc.run('JP', 'Japan', 'Asia/Tokyo', 'CAL-JP');
      })();
      lines.push('Đã dựng lịch CAL-VN, CAL-JP và địa điểm VN, JP');

      for (const year of availableYears('JP')) {
        const entries = resolveSeed('JP', year);
        importHolidays(db, { calendarId: 'CAL-JP', year, entries });
        lines.push(`Lễ Nhật ${String(year)}: ${String(entries.length)} ngày`);
      }

      // Lễ VN khai `complete: false` nên `resolveSeed` từ chối nạp — cố ý. Seed thiếu Tết
      // trông y hệt seed đủ, và engine sẽ lặng lẽ coi 5 ngày Tết là ngày làm việc.
      lines.push('Lễ VN: CHƯA có. Nhập tay qua `calendar_exception` trước khi xếp lịch thật.');
      return lines.join('\n');
    } finally {
      db.close();
    }
  }

  if (command === 'add-resource') {
    const id = required(argv, 'id');
    const roles = required(argv, 'roles')
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r !== '');
    if (roles.length === 0) throw new Error('--roles cần ít nhất một vai trò');

    const db = open(now);
    try {
      const maxParallel = arg(argv, 'max-parallel');
      db.transaction(() => {
        db.prepare('INSERT INTO resource (id,name,location_id,max_parallel) VALUES (?,?,?,?)').run(
          id,
          required(argv, 'name'),
          required(argv, 'location'),
          maxParallel === undefined ? null : Number(maxParallel),
        );
        const role = db.prepare('INSERT INTO resource_role (resource_id,role) VALUES (?,?)');
        for (const r of roles) role.run(id, r);
      })();
      return `Đã thêm ${id} với vai trò: ${roles.join(', ')}`;
    } finally {
      db.close();
    }
  }

  if (command === 'create-project') {
    const code = required(argv, 'code');
    const db = open(now);
    try {
      const id = `P-${code}`;
      db.prepare(
        `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        code,
        required(argv, 'name'),
        Number(arg(argv, 'priority') ?? '1'),
        required(argv, 'start'),
        // Mốc chuẩn khởi tạo bằng ngày bắt đầu; PM đẩy lên sau bằng "Close period" (§7.13).
        required(argv, 'start'),
        arg(argv, 'calendar') ?? 'CAL-VN',
        arg(argv, 'location') ?? 'VN',
        now,
      );
      return `Đã tạo dự án ${code} (${id})`;
    } finally {
      db.close();
    }
  }

  if (command === 'grant') {
    const email = required(argv, 'email');
    const code = required(argv, 'project');
    const role = required(argv, 'role');
    if (!['pm', 'lead', 'viewer'].includes(role)) {
      throw new Error(`--role phải là pm, lead hoặc viewer (nhận: ${role})`);
    }

    const db = open(now);
    try {
      const user = db.prepare('SELECT id FROM app_user WHERE email = ?').get(email) as
        { id: string } | undefined;
      if (user === undefined) throw new Error(`Không có tài khoản ${email}`);

      const project = db.prepare('SELECT id FROM project WHERE code = ?').get(code) as
        { id: string } | undefined;
      if (project === undefined) throw new Error(`Không có dự án ${code}`);

      const team = arg(argv, 'team') ?? null;
      // §10.6: lead chỉ nhập tiến độ cho team mình. Không có team thì quyền đó vô nghĩa —
      // chặn sớm còn hơn để lead đăng nhập vào rồi không thấy dòng nào.
      if (role === 'lead' && team === null) {
        throw new Error('Vai trò lead cần --team, nếu không lead sẽ không thấy task nào.');
      }

      db.prepare(
        `INSERT INTO user_project (user_id,project_id,role,team_id) VALUES (?,?,?,?)
         ON CONFLICT(user_id,project_id) DO UPDATE SET role = excluded.role, team_id = excluded.team_id`,
      ).run(user.id, project.id, role, team);
      return `Đã gán ${email} vào ${code} với vai ${role}`;
    } finally {
      db.close();
    }
  }

  if (command === 'import') {
    const file = required(argv, 'file');
    const db = open(now);
    try {
      const payload: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'));
      const result = importTasks(db, payload, { runId: `cli-${now}`, now });
      const { critical, major, minor } = result.report.counts;
      // In cả issue Major/Minor: import trót lọt không có nghĩa là dữ liệu sạch, và
      // §8.4 nói chỉ Critical mới chặn.
      return [
        `Đã nạp ${String(result.tasksAdded)} task`,
        `Issue: ${String(critical)} Critical · ${String(major)} Major · ${String(minor)} Minor`,
      ].join('\n');
    } finally {
      db.close();
    }
  }

  if (command === 'backup') {
    const out = resolve(required(argv, 'out'));
    const db = open(now);
    try {
      // `VACUUM INTO` chụp bản nhất quán ngay cả khi WAL đang có giao dịch dở, nên chạy
      // được trong lúc server vẫn phục vụ. Copy file thô thì không an toàn như vậy.
      db.prepare('VACUUM INTO ?').run(out);
      return `Đã sao lưu vào ${out}`;
    } finally {
      db.close();
    }
  }

  throw new Error(`Lệnh không biết: ${command}\n\n${USAGE}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('cli.js')) {
  run(process.argv.slice(2), new Date().toISOString())
    .then((message) => {
      process.stdout.write(`${message}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
