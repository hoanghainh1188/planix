/**
 * CLI quản trị là đường DUY NHẤT dựng được một DB dùng thật — §13.3 cấm đăng ký công khai.
 *
 * Thứ đáng kiểm nhất ở đây không phải chuỗi in ra, mà là: mật khẩu không bao giờ đi qua
 * tham số dòng lệnh, và `import` có Critical thì không để lại nửa vời trong DB.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { run } from '../src/cli.js';
import { resolveMcpToken } from '@planix/core/db/repo/mcp-token-repo.js';

const AT = '2026-09-13T09:00:00.000Z';
let dir: string;
let dbPath: string;

/** Nạp mật khẩu vào stdin giả — đúng cách CLI đọc nó. */
function withStdin<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const original = process.stdin;
  Object.defineProperty(process, 'stdin', {
    value: Object.assign(
      (function* () {
        yield text;
      })(),
      // CLI gọi `setEncoding` trước khi đọc; stdin giả phải có hàm đó.
      { setEncoding: () => undefined },
    ),
    configurable: true,
  });
  return fn().finally(() => {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true });
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-cli-'));
  dbPath = join(dir, 'app.db');
  process.env['PLANIX_DB'] = dbPath;

  const db = openDatabase(dbPath);
  migrate(db, AT);
  db.close();
});

afterEach(() => {
  delete process.env['PLANIX_DB'];
  rmSync(dir, { recursive: true, force: true });
});

function query<T>(sql: string): T {
  const db = openDatabase(dbPath);
  try {
    return db.prepare(sql).get() as T;
  } finally {
    db.close();
  }
}

describe('create-user', () => {
  it('tạo được admin, mật khẩu băm chứ không lưu thô', async () => {
    await withStdin('mot-mat-khau-du-dai', () =>
      run(['create-user', '--email', 'pm@x.com', '--name', 'PM', '--admin'], AT),
    );

    const u = query<{ email: string; is_admin: number; password_hash: string }>(
      `SELECT email, is_admin, password_hash FROM app_user`,
    );
    expect(u.email).toBe('pm@x.com');
    expect(u.is_admin).toBe(1);
    expect(u.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(u.password_hash).not.toContain('mot-mat-khau-du-dai');
  });

  it('không có cờ --admin thì là user thường', async () => {
    await withStdin('mot-mat-khau-du-dai', () =>
      run(['create-user', '--email', 'lead@x.com', '--name', 'Lead'], AT),
    );
    expect(query<{ is_admin: number }>(`SELECT is_admin FROM app_user`).is_admin).toBe(0);
  });

  it('mật khẩu quá ngắn bị từ chối', async () => {
    await expect(
      withStdin('ngan', () => run(['create-user', '--email', 'a@x.com', '--name', 'A'], AT)),
    ).rejects.toThrow(/12 ký tự/);
  });

  it('thiếu --email thì báo rõ, không tạo gì', async () => {
    await expect(withStdin('mot-mat-khau-du-dai', () => run(['create-user'], AT))).rejects.toThrow(
      /--email/,
    );
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM app_user').n).toBe(0);
  });
});

describe('bootstrap — dựng nền cho một DB trống', () => {
  it('tạo lịch, địa điểm và nạp lễ Nhật từ nguồn chính thức', async () => {
    const out = await run(['bootstrap'], AT);

    expect(query<{ n: number }>('SELECT COUNT(*) n FROM calendar').n).toBe(2);
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM location').n).toBe(2);
    expect(query<{ n: number }>(`SELECT COUNT(*) n FROM calendar_exception`).n).toBeGreaterThan(0);
    // Phải nói rõ lễ VN còn thiếu, không im lặng để người dùng tưởng đã đủ.
    expect(out).toContain('Lễ VN');
  });

  it('chạy lại lần hai KHÔNG hỏng', async () => {
    await run(['bootstrap'], AT);
    await expect(run(['bootstrap'], AT)).resolves.toContain('CAL-VN');
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM calendar').n).toBe(2);
  });
});

describe('add-resource', () => {
  it('thêm người kèm nhiều vai trò', async () => {
    await run(['bootstrap'], AT);
    await run(
      [
        'add-resource',
        '--id',
        'R-1',
        '--name',
        'Nguyen A',
        '--location',
        'VN',
        '--roles',
        'BrSE,Dev',
      ],
      AT,
    );
    expect(
      query<{ n: number }>(`SELECT COUNT(*) n FROM resource_role WHERE resource_id='R-1'`).n,
    ).toBe(2);
  });

  it('thiếu --roles thì báo lỗi, không thêm người nửa vời', async () => {
    await run(['bootstrap'], AT);
    await expect(
      run(['add-resource', '--id', 'R-2', '--name', 'B', '--location', 'VN', '--roles', ' '], AT),
    ).rejects.toThrow(/roles/);
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM resource').n).toBe(0);
  });
});

describe('create-project + import', () => {
  const payload = {
    version: '1.0',
    project_code: 'UTG',
    mode: 'merge',
    tasks: [
      { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
      { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 2, role: 'Dev' },
    ],
    dependencies: [],
  };

  it('tạo dự án rồi nạp task từ file', async () => {
    await run(['bootstrap'], AT);
    await run(
      ['add-resource', '--id', 'R-1', '--name', 'Dev', '--location', 'VN', '--roles', 'Dev'],
      AT,
    );
    await run(['create-project', '--code', 'UTG', '--name', 'UTG', '--start', '2026-01-05'], AT);
    const file = join(dir, 'tasks.json');
    writeFileSync(file, JSON.stringify(payload));

    const out = await run(['import', '--project', 'UTG', '--file', file], AT);
    expect(out).toContain('2 task');
    expect(out).toContain('0 Critical');
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM task').n).toBe(2);
  });

  it('file có Critical thì TỪ CHỐI cả file, DB không đổi (§9.3)', async () => {
    await run(['bootstrap'], AT);
    await run(
      ['add-resource', '--id', 'R-1', '--name', 'Dev', '--location', 'VN', '--roles', 'Dev'],
      AT,
    );
    await run(['create-project', '--code', 'UTG', '--name', 'UTG', '--start', '2026-01-05'], AT);
    const file = join(dir, 'bad.json');
    // Task `work` không có role → C04 Critical.
    writeFileSync(
      file,
      JSON.stringify({
        ...payload,
        tasks: [
          { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
          { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 2 },
        ],
      }),
    );

    await expect(run(['import', '--project', 'UTG', '--file', file], AT)).rejects.toThrow();
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM task').n).toBe(0);
  });
});

describe('grant — gán người vào dự án (§10.6)', () => {
  async function setup(): Promise<void> {
    await run(['bootstrap'], AT);
    await run(['create-project', '--code', 'UTG', '--name', 'UTG', '--start', '2026-01-05'], AT);
    await withStdin('mot-mat-khau-du-dai', () =>
      run(['create-user', '--email', 'pm@x.com', '--name', 'PM'], AT),
    );
  }

  it('gán PM vào dự án', async () => {
    await setup();
    await run(['grant', '--email', 'pm@x.com', '--project', 'UTG', '--role', 'pm'], AT);
    expect(query<{ role: string }>('SELECT role FROM user_project').role).toBe('pm');
  });

  it('lead KHÔNG có --team bị chặn — lead sẽ không thấy task nào', async () => {
    await setup();
    await expect(
      run(['grant', '--email', 'pm@x.com', '--project', 'UTG', '--role', 'lead'], AT),
    ).rejects.toThrow(/--team/);
  });

  it('vai trò lạ bị chặn', async () => {
    await setup();
    await expect(
      run(['grant', '--email', 'pm@x.com', '--project', 'UTG', '--role', 'sep-tong'], AT),
    ).rejects.toThrow(/pm, lead/);
  });

  it('gán lại thì CẬP NHẬT vai, không tạo dòng thứ hai', async () => {
    await setup();
    await run(['grant', '--email', 'pm@x.com', '--project', 'UTG', '--role', 'viewer'], AT);
    await run(['grant', '--email', 'pm@x.com', '--project', 'UTG', '--role', 'pm'], AT);
    expect(query<{ n: number }>('SELECT COUNT(*) n FROM user_project').n).toBe(1);
    expect(query<{ role: string }>('SELECT role FROM user_project').role).toBe('pm');
  });

  it('email không tồn tại thì báo rõ', async () => {
    await setup();
    await expect(
      run(['grant', '--email', 'khong@co.com', '--project', 'UTG', '--role', 'pm'], AT),
    ).rejects.toThrow(/khong@co.com/);
  });
});

describe('backup', () => {
  it('tạo được bản sao đọc lại được', async () => {
    await run(['bootstrap'], AT);
    await run(['create-project', '--code', 'UTG', '--name', 'UTG', '--start', '2026-01-05'], AT);
    const out = join(dir, 'backup.db');
    await run(['backup', '--out', out], AT);

    const copy = openDatabase(out);
    try {
      const r = copy.prepare('SELECT COUNT(*) n FROM project').get() as { n: number };
      expect(r.n).toBe(1);
    } finally {
      copy.close();
    }
  });
});

describe('trợ giúp', () => {
  it('không tham số thì in hướng dẫn', async () => {
    expect(await run([], AT)).toContain('create-user');
  });

  it('lệnh lạ thì báo lỗi kèm hướng dẫn', async () => {
    await expect(run(['khong-co-lenh-nay'], AT)).rejects.toThrow(/create-user/);
  });
});

/**
 * Token MCP (§12.4). Vòng đời đi qua ĐÚNG cửa mà người vận hành dùng: CLI cấp, endpoint
 * nhận. Kiểm riêng repo sẽ bỏ lọt khả năng CLI in ra một chuỗi khác thứ nó vừa lưu hash.
 */
describe('mcp-token', () => {
  async function makeUser(): Promise<void> {
    await withStdin('mot-mat-khau-du-dai', () =>
      run(['create-user', '--email', 'pm@x.com', '--name', 'PM'], AT),
    );
  }

  /** Token nằm trên dòng riêng trong bản in ra — rút đúng nó, không rút cả câu. */
  function tokenFrom(output: string): string {
    const line = output.split('\n').find((l) => l.startsWith('planix_mcp_'));
    expect(line).toBeDefined();
    return line ?? '';
  }

  it('token in ra dùng được thật, và DB chỉ giữ hash', async () => {
    await makeUser();
    const out = await run(['mcp-token', '--email', 'pm@x.com', '--label', 'claude'], AT);
    const token = tokenFrom(out);

    const db = openDatabase(dbPath);
    try {
      // Cấp ở tiến trình CLI, tra ở đây — đúng chỗ một lỗi "in ra khác thứ đã lưu" lộ ra.
      const principal = resolveMcpToken(db, token, AT);
      expect(principal?.userId).toMatch(/^U-/);

      const stored = db.prepare('SELECT token_hash FROM mcp_token').get() as {
        token_hash: string;
      };
      expect(stored.token_hash).not.toBe(token);
      expect(stored.token_hash).not.toContain(token);
    } finally {
      db.close();
    }
  });

  it('email không có thì từ chối, không cấp token mồ côi', async () => {
    await expect(
      run(['mcp-token', '--email', 'khong-co@x.com', '--label', 'x'], AT),
    ).rejects.toThrow('Không có người dùng');

    const db = openDatabase(dbPath);
    try {
      const count = db.prepare('SELECT COUNT(*) AS n FROM mcp_token').get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it('liệt kê không bao giờ hiện token', async () => {
    await makeUser();
    const token = tokenFrom(
      await run(['mcp-token', '--email', 'pm@x.com', '--label', 'claude'], AT),
    );

    const listed = await run(['mcp-tokens'], AT);
    expect(listed).toContain('claude');
    expect(listed).toContain('chưa bao giờ');
    expect(listed).not.toContain(token);
  });

  it('thu hồi rồi thì token hết tác dụng, gọi lần hai nói rõ đã thu hồi', async () => {
    await makeUser();
    const out = await run(['mcp-token', '--email', 'pm@x.com', '--label', 'claude'], AT);
    const token = tokenFrom(out);
    const id = out.split(' ')[3] ?? '';
    expect(id).toMatch(/^MCP-/);

    expect(await run(['mcp-revoke', '--id', id], AT)).toContain('Đã thu hồi');

    const db = openDatabase(dbPath);
    try {
      expect(resolveMcpToken(db, token, AT)).toBeNull();
    } finally {
      db.close();
    }

    expect(await run(['mcp-revoke', '--id', id], AT)).toContain('đã bị thu hồi từ');
    await expect(run(['mcp-revoke', '--id', 'MCP-khong-co'], AT)).rejects.toThrow('Không có token');
  });
});
