import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { run } from '../src/scheduler/worker.js';
import { runSchedulerInWorker } from '../src/scheduler/run-in-worker.js';

const AT = '2026-09-13T09:00:00.000Z';
let dir: string;
let dbPath: string;

function seed(withRole = true): void {
  const db = openDatabase(dbPath);
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P','UTG','UTG',1,'2026-01-05','2026-01-05','CAL','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  importTasks(
    db,
    {
      version: '1.0',
      project_code: 'UTG',
      mode: 'merge',
      tasks: [
        { tmp_id: 'r', parent_tmp_id: null, name: 'Root', kind: 'summary' },
        { tmp_id: 'a', parent_tmp_id: 'r', name: 'A', kind: 'work', effort_md: 2, role: 'Dev' },
      ],
      dependencies: [],
    },
    { runId: 'I', now: AT },
  );
  // Importer tự chặn C04, nên phải import hợp lệ rồi mới gỡ role để dựng dữ liệu hỏng.
  if (!withRole) db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-worker-'));
  dbPath = join(dir, 'test.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('worker mở kết nối DB riêng tới file (§3.1)', () => {
  it('lập lịch xong và trả về số liệu', () => {
    seed();
    const res = run({
      dbPath,
      projectId: 'P',
      scope: 'project' as const,
      runId: 'R',
      now: AT,
      windowDays: 400,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scheduledCount).toBe(1);
      expect(res.assignedCount).toBe(1);
      expect(res.writeLockMs).toBeLessThan(200);
    }
  });

  it('kết quả THẬT SỰ được ghi xuống file, không chỉ trong bộ nhớ worker', () => {
    seed();
    run({
      dbPath,
      projectId: 'P',
      scope: 'project' as const,
      runId: 'R',
      now: AT,
      windowDays: 400,
    });

    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS n FROM schedule').get() as { n: number };
    db.close();
    expect(row.n).toBe(1);
  });

  it('bị Critical chặn thì trả về danh sách mã, không ném ra ngoài thread', () => {
    seed(false);
    const res = run({
      dbPath,
      projectId: 'P',
      scope: 'project' as const,
      runId: 'R',
      now: AT,
      windowDays: 400,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.name).toBe('ScheduleBlockedError');
      expect(res.criticalCodes).toContain('C04');
    }
  });

  it("chế độ 'all' gộp số liệu mọi dự án và trả thứ tự đã xếp", () => {
    seed();
    const res = run({ dbPath, projectId: 'P', scope: 'all', runId: 'R', now: AT, windowDays: 400 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.order).toEqual(['P']);
  });

  it('dự án không tồn tại thì trả lỗi có tên, không làm sập worker', () => {
    seed();
    const res = run({ dbPath, projectId: 'KHONG-CO', scope: 'project', runId: 'R', now: AT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/KHONG-CO/);
  });
});

describe('giao thức spawn worker', () => {
  /** Worker giả bằng JS thuần — worker thread không hiểu TypeScript. */
  function fakeWorker(body: string): string {
    const file = join(dir, `fake-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(file, body, 'utf8');
    // Trả đường dẫn thuần: `new Worker()` nhận path hoặc URL, chuỗi "file://..." bị coi
    // là tên file theo nghĩa đen và không mở được.
    return file;
  }

  it('trả về message worker gửi', async () => {
    const worker = fakeWorker(
      `import { parentPort } from 'node:worker_threads';
       parentPort.postMessage({ ok: true, scheduledCount: 7, assignedCount: 7, writeLockMs: 1, projectEnd: null, issueCount: 0 });`,
    );
    const res = await runSchedulerInWorker(
      { dbPath, projectId: 'P', scope: 'project' as const, runId: 'R', now: AT },
      { workerPath: worker },
    );
    expect(res).toMatchObject({ ok: true, scheduledCount: 7 });
  });

  it('worker ném lỗi thì thành kết quả thất bại, KHÔNG làm sập tiến trình chính', async () => {
    const worker = fakeWorker(`throw new Error('worker no');`);
    const res = await runSchedulerInWorker(
      { dbPath, projectId: 'P', scope: 'project' as const, runId: 'R', now: AT },
      { workerPath: worker },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/worker no/);
  });

  it('worker thoát mà không gửi gì thì báo rõ, không treo mãi', async () => {
    const worker = fakeWorker(`process.exit(3);`);
    const res = await runSchedulerInWorker(
      { dbPath, projectId: 'P', scope: 'project' as const, runId: 'R', now: AT },
      { workerPath: worker },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.name).toBe('SchedulerWorkerExit');
  });

  it('quá thời gian thì huỷ worker thay vì để API treo', async () => {
    // Timer thật, không phải promise treo: promise không resolve KHÔNG giữ event loop
    // sống, nên worker sẽ thoát ngay và ta đo nhầm nhánh exit thay vì nhánh timeout.
    const worker = fakeWorker(`setTimeout(() => {}, 60_000);`);
    const res = await runSchedulerInWorker(
      { dbPath, projectId: 'P', scope: 'project' as const, runId: 'R', now: AT },
      { workerPath: worker, timeoutMs: 150 },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.name).toBe('SchedulerTimeout');
  });
});
