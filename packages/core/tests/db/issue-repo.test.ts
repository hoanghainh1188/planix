/**
 * Lưu kết quả validate — SPEC.md §8, màn S6.
 *
 * Cho tới trước đây KHÔNG dòng mã production nào ghi vào `validation_issue`: validate
 * chạy, trả report về cho người gọi, rồi report đó bị vứt đi. Hệ quả là panel Issues
 * luôn trống và chấm đỏ trên cây không bao giờ hiện, kể cả khi dự án hỏng nặng.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { loadIssues } from '../../src/db/repo/read-repo.js';
import { loadLastValidationRun, recordValidationRun } from '../../src/db/repo/issue-repo.js';

const AT = '2026-09-13T00:00:00.000Z';
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL')`,
  ).run();
  for (const [id, code] of [
    ['P', 'UTG'],
    ['Q', 'GEO'],
  ]) {
    db.prepare(
      `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
       VALUES (?,?,?,1,'2026-01-05','2026-01-05','CAL','VN',?)`,
    ).run(id, code, code, AT);
  }
});

function count(projectId: string): number {
  return (
    db.prepare('SELECT COUNT(*) n FROM validation_issue WHERE project_id = ?').get(projectId) as {
      n: number;
    }
  ).n;
}

describe('recordValidationRun', () => {
  it('ghi xuống và đọc lại được qua đúng đường mà màn S6 dùng', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [
        { severity: 'Critical', code: 'C04', message: 'Work task has no role.', taskUid: 'T-1' },
        { severity: 'Minor', code: 'N01', message: 'SF is rarely correct.' },
      ],
    });

    const issues = loadIssues(db, 'P');
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.code).sort()).toEqual(['C04', 'N01']);
    expect(issues.find((i) => i.code === 'C04')?.taskUid).toBe('T-1');
    expect(issues.find((i) => i.code === 'N01')?.taskUid).toBeNull();
  });

  it('run mới THAY run cũ, không cộng dồn', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [{ severity: 'Critical', code: 'C04', message: 'a' }],
    });
    recordValidationRun(db, {
      runId: 'r2',
      projectId: 'P',
      detectedAt: '2026-09-14T00:00:00.000Z',
      issues: [{ severity: 'Major', code: 'J05', message: 'b' }],
    });

    expect(count('P')).toBe(1);
    expect(loadIssues(db, 'P').map((i) => i.code)).toEqual(['J05']);
  });

  it('run sạch xoá hết dấu vết của run trước — sửa xong thì panel phải trống', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [{ severity: 'Critical', code: 'C04', message: 'a' }],
    });
    recordValidationRun(db, { runId: 'r2', projectId: 'P', detectedAt: AT, issues: [] });

    expect(count('P')).toBe(0);
    expect(loadIssues(db, 'P')).toEqual([]);
  });

  it('dự án này không xoá issue của dự án kia', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'Q',
      detectedAt: AT,
      issues: [{ severity: 'Major', code: 'J05', message: 'geo' }],
    });
    recordValidationRun(db, {
      runId: 'r2',
      projectId: 'P',
      detectedAt: AT,
      issues: [{ severity: 'Critical', code: 'C04', message: 'utg' }],
    });

    expect(count('Q')).toBe(1);
    expect(count('P')).toBe(1);
    expect(loadIssues(db, 'Q').map((i) => i.message)).toEqual(['geo']);
  });

  it('giữ `detail` — đường đi của C01 nằm trong đó, mất là mất luôn thứ §8.1 đòi', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [
        {
          severity: 'Critical',
          code: 'C01',
          message: 'Dependency cycle: A -> B -> A',
          detail: { path: ['A', 'B', 'A'] },
        },
      ],
    });

    const raw = db.prepare('SELECT detail_json FROM validation_issue').get() as {
      detail_json: string | null;
    };
    expect(JSON.parse(raw.detail_json ?? 'null')).toEqual({ path: ['A', 'B', 'A'] });
  });

  it('issue không có detail thì để NULL, không ghi chuỗi "undefined"', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [{ severity: 'Minor', code: 'N01', message: 'x' }],
    });
    expect(db.prepare('SELECT detail_json FROM validation_issue').get()).toEqual({
      detail_json: null,
    });
  });
});

describe('loadLastValidationRun — phân biệt "sạch" với "chưa ai kiểm"', () => {
  it('chưa chạy lần nào thì null', () => {
    expect(loadLastValidationRun(db, 'P')).toBeNull();
  });

  it('chạy rồi mà không có vấn đề gì thì KHÔNG null — đó là "sạch", không phải "chưa biết"', () => {
    recordValidationRun(db, { runId: 'r1', projectId: 'P', detectedAt: AT, issues: [] });

    const run = loadLastValidationRun(db, 'P');
    expect(run).not.toBeNull();
    expect(run?.ranAt).toBe(AT);
    expect(run).toMatchObject({ critical: 0, major: 0, minor: 0 });
  });

  it('đếm đúng theo từng mức', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [
        { severity: 'Critical', code: 'C04', message: 'a' },
        { severity: 'Critical', code: 'C07', message: 'b' },
        { severity: 'Major', code: 'J05', message: 'c' },
        { severity: 'Minor', code: 'N01', message: 'd' },
      ],
    });
    expect(loadLastValidationRun(db, 'P')).toMatchObject({ critical: 2, major: 1, minor: 1 });
  });

  it('lượt sau ghi đè lượt trước, mỗi dự án đúng một dòng', () => {
    recordValidationRun(db, {
      runId: 'r1',
      projectId: 'P',
      detectedAt: AT,
      issues: [{ severity: 'Critical', code: 'C04', message: 'a' }],
    });
    recordValidationRun(db, {
      runId: 'r2',
      projectId: 'P',
      detectedAt: '2026-09-14T00:00:00.000Z',
      issues: [],
    });

    expect(db.prepare('SELECT COUNT(*) n FROM validation_run').get()).toEqual({ n: 1 });
    expect(loadLastValidationRun(db, 'P')).toMatchObject({
      runId: 'r2',
      ranAt: '2026-09-14T00:00:00.000Z',
      critical: 0,
    });
  });

  it('xoá dự án thì dòng này đi theo (ON DELETE CASCADE)', () => {
    recordValidationRun(db, { runId: 'r1', projectId: 'P', detectedAt: AT, issues: [] });
    db.prepare('DELETE FROM project WHERE id = ?').run('P');
    expect(loadLastValidationRun(db, 'P')).toBeNull();
  });
});
