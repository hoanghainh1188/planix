import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

/** Migration mở đầu bằng dòng này sẽ KHÔNG được bọc trong transaction. */
const NO_TRANSACTION_MARKER = '-- planix:no-transaction';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrateResult {
  /** Migration filenames applied by this call, in the order they ran. */
  readonly applied: readonly string[];
}

/**
 * Open a database with the pragmas the rest of the engine assumes.
 *
 * `foreign_keys` is OFF by default in SQLite and is a per-connection setting, not a
 * property of the file. Forget it and every REFERENCES clause in §4.2 becomes a comment.
 */
export function openDatabase(filename: string): Db {
  const db = new Database(filename);

  db.pragma('foreign_keys = ON');

  // WAL is what §3.1 specifies: many readers, one writer process. It is meaningless
  // for an in-memory database, and SQLite refuses it there, so only ask for it on files.
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

/**
 * Apply every migration not yet recorded, in filename order, each in its own transaction.
 *
 * Running this twice is a no-op: already-applied filenames are skipped. Migration files
 * are never edited once merged (CLAUDE.md §3), so a recorded name always means the same
 * SQL ran.
 *
 * `appliedAt` is passed in rather than read from the system clock. Nothing downstream
 * reads the column, but N2 bans clock reads inside `packages/core` outright and the
 * boundary is worth keeping sharp: callers at the edge own the clock, core stays pure.
 */
export function migrate(db: Db, appliedAt: string): MigrateResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const done = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  // Sort by filename so the order is fixed and does not depend on how the filesystem
  // happens to return directory entries (N2).
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !done.has(name));

  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const applied: string[] = [];

  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

    if (sql.startsWith(NO_TRANSACTION_MARKER)) {
      // Migration tự lo giao dịch của nó. Cần cho việc dựng lại bảng: SQLite không có
      // `ALTER COLUMN ... SET DEFAULT`, và thủ tục dựng lại đòi `PRAGMA foreign_keys=OFF`
      // — pragma đó bị bỏ qua khi đang ở trong một transaction.
      //
      // Đánh đổi: tiến trình chết giữa chừng thì migration này có thể chạy lại lần sau.
      // Vì vậy mọi migration dùng cờ này phải viết sao cho chạy hai lần vẫn ra một kết quả.
      db.exec(sql);
      record.run(name, appliedAt);
    } else {
      db.transaction(() => {
        db.exec(sql);
        record.run(name, appliedAt);
      })();
    }

    applied.push(name);
  }

  return { applied };
}
