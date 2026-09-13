/**
 * §10.1: "Trước khi ghi kết quả recalculate, hiện bảng so sánh trước/sau... PM xác nhận
 * rồi mới lưu."
 *
 * Điều phải kiểm ở đây không phải là bảng so sánh trông thế nào, mà là DB THẬT không bị
 * đụng tới. Nếu xem trước mà vẫn ghi thì nút "Discard" trở thành lời nói dối.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '@planix/core/db/migrate.js';
import { importTasks } from '@planix/core/io/importer.js';
import { previewRecalculate } from '../src/scheduler/preview.js';
import { loadIssues } from '@planix/core/db/repo/read-repo.js';
import { run } from '../src/scheduler/worker.js';
import type { SchedulerRequest } from '../src/scheduler/protocol.js';

const AT = '2026-09-13T09:00:00.000Z';
let dir: string;
let dbPath: string;
let db: Db;

/** Chạy engine THẲNG trong tiến trình test, không cần `worker.js` đã build. */
const inline = (request: SchedulerRequest) => Promise.resolve(run(request));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-preview-test-'));
  dbPath = join(dir, 'app.db');
  db = openDatabase(dbPath);
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
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'B', kind: 'work', effort_md: 3, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function scheduleRows(): unknown[] {
  return db.prepare('SELECT task_uid, start_date, end_date FROM schedule ORDER BY task_uid').all();
}

describe('xem trước KHÔNG ghi vào DB thật (§10.1)', () => {
  it('DB chưa có lịch thì sau khi xem trước vẫn chưa có', async () => {
    expect(scheduleRows()).toEqual([]);

    const res = await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    expect(res.result.ok).toBe(true);
    expect(res.after.length).toBeGreaterThan(0);
    // Đây là khẳng định quan trọng nhất của cả file.
    expect(scheduleRows()).toEqual([]);
  });

  it('DB đã có lịch thì lịch đó KHÔNG bị đổi', async () => {
    // Chạy thật một lần để có lịch nền.
    run({ dbPath, projectId: 'P', scope: 'project', runId: 'real', now: AT });
    const before = scheduleRows();
    expect(before.length).toBeGreaterThan(0);

    await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    expect(scheduleRows()).toEqual(before);
  });

  it('`before` là lịch hiện tại, `after` là lịch engine vừa tính', async () => {
    run({ dbPath, projectId: 'P', scope: 'project', runId: 'real', now: AT });

    const res = await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    expect(res.before.length).toBe(res.after.length);
    // M2: cùng đầu vào ra cùng đầu ra — chạy lại không có gì đổi.
    expect(res.after).toEqual(res.before);
  });

  it('sửa effort rồi xem trước thì `after` KHÁC `before`, còn DB vẫn nguyên', async () => {
    run({ dbPath, projectId: 'P', scope: 'project', runId: 'real', now: AT });
    const untouched = scheduleRows();

    db.prepare(`UPDATE task SET effort_md = 20 WHERE name = 'A'`).run();

    const res = await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    expect(res.after).not.toEqual(res.before);
    expect(scheduleRows()).toEqual(untouched);
  });

  /**
   * Xem trước chạy engine trên BẢN SAO (`VACUUM INTO`), nên mọi thứ engine ghi — kể cả
   * kết quả validate — đều rơi vào bản sao rồi bị xoá cùng thư mục tạm.
   *
   * Với lịch thì đó chính là điều ta muốn (§10.1: không ghi gì cho tới khi PM duyệt).
   * Với issue thì ngược lại: bị chặn là lúc PM cần đọc nhất, mà PM không bao giờ tới
   * được bước duyệt để engine chạy lại trên DB thật. Không ghi ở đây thì panel S6 trống
   * đúng vào lúc dự án hỏng.
   */
  it('bị chặn thì issue vẫn xuống DB THẬT, dù lịch thì không', async () => {
    db.prepare(`UPDATE task SET role = NULL WHERE kind = 'work'`).run();
    const untouched = scheduleRows();

    const res = await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    expect(res.result.ok).toBe(false);
    // Lịch KHÔNG đổi — §10.1 vẫn được giữ.
    expect(scheduleRows()).toEqual(untouched);
    // Nhưng issue thì có, trên DB thật.
    expect(loadIssues(db, 'P').map((i) => i.code)).toContain('C04');
  });

  it('xem trước trót lọt thì KHÔNG ghi issue — chưa có gì xảy ra để mà báo cáo', async () => {
    const before = loadIssues(db, 'P');
    await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });
    expect(loadIssues(db, 'P')).toEqual(before);
  });

  it('không để lại file tạm nào', async () => {
    const { readdirSync } = await import('node:fs');
    const beforeFiles = readdirSync(tmpdir()).filter((f) => f.startsWith('planix-preview-')).length;

    await previewRecalculate({
      db,
      dbPath,
      projectId: 'P',
      scope: 'project',
      now: AT,
      runScheduler: inline,
    });

    const afterFiles = readdirSync(tmpdir()).filter((f) => f.startsWith('planix-preview-')).length;
    expect(afterFiles).toBe(beforeFiles);
  });
});
