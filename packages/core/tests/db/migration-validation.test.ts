/**
 * Migration 004 + 005 — bảng `validation_run` và lịch sử của nó.
 *
 * Kiểm CẢ CHUỖI trên một DB có dữ liệu thật, không kiểm riêng từng file: 004 dựng bảng
 * một-dòng-mỗi-dự-án, 005 dựng lại thành nhiều dòng và nối `validation_issue` vào bằng
 * khoá thật. Thứ cần bảo đảm là DB đang chạy đi qua được cả hai mà không mất gì — kiểm
 * từng migration một sẽ bỏ lọt đúng chỗ chúng giao nhau.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { importTasks } from '../../src/io/importer.js';
import { loadIssues } from '../../src/db/repo/read-repo.js';
import {
  loadLastValidationRun,
  loadValidationHistory,
  recordValidationRun,
} from '../../src/db/repo/issue-repo.js';

const AT = '2026-09-13T00:00:00.000Z';
let dir: string;
let db: Db;

function seed(): void {
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
        { tmp_id: 'b', parent_tmp_id: 'r', name: 'B', kind: 'work', effort_md: 1, role: 'Dev' },
      ],
      dependencies: [{ pred: 'a', succ: 'b', type: 'FS', lag_days: 0 }],
    },
    { runId: 'I', now: AT },
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planix-mig-val-'));
  db = openDatabase(join(dir, 'app.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('chuỗi migration trên DB có dữ liệu', () => {
  it('chạy hết, không mất task hay dependency, khoá ngoại còn nguyên', () => {
    migrate(db, AT);
    seed();

    expect((db.prepare('SELECT COUNT(*) n FROM task').get() as { n: number }).n).toBe(3);
    expect((db.prepare('SELECT COUNT(*) n FROM dependency').get() as { n: number }).n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('bảng cuối cùng có đủ cột mà lịch sử cần', () => {
    migrate(db, AT);
    const columns = (
      db.prepare('PRAGMA table_info(validation_run)').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'run_id',
        'source',
        'first_at',
        'last_at',
        'fingerprint',
        'critical',
        'major',
        'minor',
      ]),
    );

    const issueColumns = (
      db.prepare('PRAGMA table_info(validation_issue)').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(issueColumns).toContain('run_pk');
  });

  it('một dự án giữ được NHIỀU lượt — đó là cả điểm của 005', () => {
    migrate(db, AT);
    seed();
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: '2026-09-13T01:00:00.000Z',
      source: 'edit',
      issues: [{ severity: 'Major', code: 'J05', message: 'a' }],
    });
    recordValidationRun(db, {
      runId: 'r2',
      projectId: 'P',
      detectedAt: '2026-09-13T02:00:00.000Z',
      source: 'schedule',
      issues: [{ severity: 'Minor', code: 'N01', message: 'b' }],
    });

    expect(loadValidationHistory(db, 'P').length).toBeGreaterThanOrEqual(2);
  });

  it('import đã đóng dấu một lượt — đó chính là §8 "sau mỗi lần import"', () => {
    migrate(db, AT);
    seed();
    expect(loadLastValidationRun(db, 'P')).toMatchObject({ runId: 'I', source: 'import' });
  });

  it('dự án chưa ai đụng tới thì chưa có lượt nào', () => {
    migrate(db, AT);
    seed();
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES ('Q','GEO','GEO',2,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(AT);
    expect(loadLastValidationRun(db, 'Q')).toBeNull();
  });

  it('nguồn lạ bị CHECK chặn — cột `source` không phải bãi chứa chuỗi tuỳ ý', () => {
    migrate(db, AT);
    seed();
    expect(() =>
      db
        .prepare(
          `INSERT INTO validation_run
             (project_id,run_id,source,first_at,last_at,fingerprint)
           VALUES ('P','x','khong-phai-nguon',?,?,'')`,
        )
        .run(AT, AT),
    ).toThrow();
  });

  it('xoá một lượt thì issue của nó đi theo, panel đọc sang lượt còn lại', () => {
    migrate(db, AT);
    seed();
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: '2026-09-13T01:00:00.000Z',
      source: 'edit',
      issues: [{ severity: 'Major', code: 'J05', message: 'a' }],
    });
    recordValidationRun(db, {
      runId: 'r2',
      projectId: 'P',
      detectedAt: '2026-09-13T02:00:00.000Z',
      source: 'edit',
      issues: [{ severity: 'Minor', code: 'N01', message: 'b' }],
    });

    const history = loadValidationHistory(db, 'P');
    const newest = history[0];
    expect(newest).toBeDefined();
    db.prepare('DELETE FROM validation_run WHERE id = ?').run(newest?.id ?? 0);

    expect(
      (
        db
          .prepare('SELECT COUNT(*) n FROM validation_issue WHERE run_pk = ?')
          .get(newest?.id ?? 0) as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(loadIssues(db, 'P').map((i) => i.code)).toEqual(['J05']);
  });
});
