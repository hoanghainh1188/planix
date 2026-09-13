import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/db/migrate.js';
import { dryRunImport, importTasks } from '../../src/io/importer.js';
import { loadIssues } from '../../src/db/repo/read-repo.js';

const AT = '2026-09-13T00:00:00.000Z';

function setup(): Db {
  const db = openDatabase(':memory:');
  migrate(db, AT);
  db.prepare(
    `INSERT INTO calendar (id,name,scope,week_pattern) VALUES ('CAL-VN','VN','location','1111100')`,
  ).run();
  db.prepare(
    `INSERT INTO location (id,name,timezone,calendar_id) VALUES ('VN','VN','Asia/Ho_Chi_Minh','CAL-VN')`,
  ).run();
  db.prepare(
    `INSERT INTO project (id,code,name,priority,start_date,status_date,calendar_id,default_location,created_at)
     VALUES ('P-UTG','UTG','UTG',1,'2026-01-01','2026-01-01','CAL-VN','VN',?)`,
  ).run(AT);
  db.prepare(`INSERT INTO resource (id,name,location_id) VALUES ('R-1','Dev A','VN')`).run();
  db.prepare(`INSERT INTO resource_role (resource_id,role) VALUES ('R-1','Dev')`).run();
  return db;
}

/** Payload hợp lệ tối thiểu: 1 summary + 2 task con. */
function goodPayload() {
  return {
    version: '1.0',
    project_code: 'UTG',
    mode: 'merge',
    tasks: [
      { tmp_id: 'a1', parent_tmp_id: null, name: 'User management', kind: 'summary' },
      {
        tmp_id: 'a2',
        parent_tmp_id: 'a1',
        name: 'Design user list',
        kind: 'work',
        effort_md: 0.5,
        role: 'Dev',
      },
      {
        tmp_id: 'a3',
        parent_tmp_id: 'a1',
        name: 'Build user list',
        kind: 'work',
        effort_md: 1.5,
        role: 'Dev',
      },
    ],
    dependencies: [{ pred: 'a2', succ: 'a3', type: 'FS', lag_days: 0 }],
  };
}

function countTasks(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number };
  return row.n;
}

let db: Db;
beforeEach(() => {
  db = setup();
});

// better-sqlite3 giữ bộ nhớ native tới khi close(). Bỏ quên thì worker vitest có thể
// bị SIGSEGV trên máy ít RAM — đã xảy ra thật ở CI với golden test.
afterEach(() => {
  db.close();
});

describe('importer — validate schema bằng zod (§9.3 bước 1)', () => {
  it('thiếu trường bắt buộc → từ chối CẢ FILE, không import một phần', () => {
    const bad = goodPayload();
    // @ts-expect-error co tinh lam hong payload
    delete bad.tasks[1].name;
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow();
    expect(countTasks(db)).toBe(0);
  });

  it('kind lạ → từ chối cả file', () => {
    const bad = goodPayload();
    bad.tasks[1] = { ...bad.tasks[1], kind: 'khong-hop-le' } as never;
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow();
    expect(countTasks(db)).toBe(0);
  });

  it('AI gửi kèm ngày tháng → từ chối (§9.1: không ngày, không tên người, không wbs_code)', () => {
    const bad = { ...goodPayload() } as Record<string, unknown>;
    (bad['tasks'] as Array<Record<string, unknown>>)[1]!['start_date'] = '2026-03-01';
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow();
    expect(countTasks(db)).toBe(0);
  });

  it('replace-subtree mà thiếu root_uid → từ chối', () => {
    const bad = { ...goodPayload(), mode: 'replace-subtree' };
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/root_uid/i);
  });

  it('project_code không tồn tại → từ chối', () => {
    const bad = { ...goodPayload(), project_code: 'KHONG-CO' };
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/KHONG-CO/);
  });
});

describe('importer — cấp uid và dịch dependency (§9.3 bước 2-3)', () => {
  it('cấp uid theo thứ tự xuất hiện và trả về bảng ánh xạ', () => {
    const res = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    expect(res.mapping).toEqual({ a1: 'T-0001', a2: 'T-0002', a3: 'T-0003' });
    expect(res.tasksAdded).toBe(3);
  });

  it('dependency được dịch từ tmp_id sang uid thật', () => {
    importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const rows = db.prepare('SELECT pred_uid, succ_uid, type FROM dependency').all();
    expect(rows).toEqual([{ pred_uid: 'T-0002', succ_uid: 'T-0003', type: 'FS' }]);
  });

  it('dependency trỏ tới tmp_id không khai trong file → từ chối', () => {
    const bad = goodPayload();
    bad.dependencies = [{ pred: 'a2', succ: 'khong-co', type: 'FS', lag_days: 0 }];
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/khong-co/);
    expect(countTasks(db)).toBe(0);
  });
});

describe('importer — renumber (§9.3 bước 4)', () => {
  it('sinh wbs_code và depth đúng', () => {
    importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const rows = db.prepare('SELECT uid, wbs_code, depth FROM task ORDER BY uid').all() as Array<{
      uid: string;
      wbs_code: string;
      depth: number;
    }>;
    expect(rows).toEqual([
      { uid: 'T-0001', wbs_code: '1', depth: 1 },
      { uid: 'T-0002', wbs_code: '1.1', depth: 2 },
      { uid: 'T-0003', wbs_code: '1.2', depth: 2 },
    ]);
  });
});

describe('importer — rollback khi có Critical (§9.3 bước 5)', () => {
  it('role không ai đảm nhiệm (C05) → rollback, DB không đổi', () => {
    const bad = goodPayload();
    bad.tasks[1] = { ...bad.tasks[1], role: 'Designer' } as never;
    const before = countTasks(db);
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/C05/);
    expect(countTasks(db)).toBe(before);
  });

  it('vòng lặp phụ thuộc (C01) → rollback', () => {
    const bad = goodPayload();
    bad.dependencies = [
      { pred: 'a2', succ: 'a3', type: 'FS', lag_days: 0 },
      { pred: 'a3', succ: 'a2', type: 'FS', lag_days: 0 },
    ];
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/C01/);
    expect(countTasks(db)).toBe(0);
  });

  it('work thiếu effort (C07) → rollback', () => {
    const bad = goodPayload();
    bad.tasks[2] = { ...bad.tasks[2], effort_md: 0 } as never;
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/C07/);
    expect(countTasks(db)).toBe(0);
  });

  /**
   * Ở ĐÂY thì không ghi issue — khác hẳn đường schedule.
   *
   * Import hỏng thì cả transaction rollback (§9.3): task vừa nạp biến mất. Issue trỏ vào
   * những uid đó sẽ là rác trỏ vào hư không, và panel sẽ tố cáo một dự án theo lỗi của
   * một lần nạp chưa từng xảy ra. Người gọi vẫn nhận đủ report qua `ImportValidationError`.
   */
  it('KHÔNG để lại issue sau khi rollback — task đã biến mất thì issue trỏ vào đâu', () => {
    const bad = goodPayload();
    bad.dependencies = [
      { pred: 'a2', succ: 'a3', type: 'FS', lag_days: 0 },
      { pred: 'a3', succ: 'a2', type: 'FS', lag_days: 0 },
    ];
    expect(() => importTasks(db, bad, { runId: 'R1', now: AT })).toThrow(/C01/);
    expect(loadIssues(db, 'P-UTG')).toEqual([]);
  });
});

describe('importer — ghi kết quả validate (§8 "sau mỗi lần import")', () => {
  it('nạp trót lọt thì kết quả validate xuống bảng, panel S6 đọc được', () => {
    // Rác của lượt trước phải bị thay, không cộng dồn.
    db.prepare(
      `INSERT INTO validation_issue (run_id,project_id,severity,code,message,detected_at)
       VALUES ('cu','P-UTG','Critical','C99','rac cua luot truoc',?)`,
    ).run(AT);

    importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    expect(loadIssues(db, 'P-UTG').map((i) => i.code)).not.toContain('C99');
  });

  /**
   * Hôm nay nhánh này LUÔN ghi xuống rỗng, và đó không phải lỗi của đường ghi.
   *
   * `validator.ts` hiện chỉ cài các rule Critical (C01–C12) — mà Critical nào cũng chặn
   * import và rollback. Nên một lần nạp trót lọt, theo định nghĩa, không còn issue nào.
   * Các rule Major/Minor mà §8.2–§8.3 liệt kê chưa được cài; J02 chẳng hạn nằm trong
   * `rollup.ts` và chỉ sinh ra lúc xếp lịch, không đi qua `validate()`.
   *
   * Xem docs/decisions/2026-09-13-validator-rules-con-thieu.md. Khi những rule đó có
   * mặt, đường ghi này đã sẵn sàng — không phải sửa gì thêm.
   */
  it('nạp trót lọt trên dữ liệu sạch thì panel trống, không phải trống vì quên ghi', () => {
    const result = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    expect(result.report.issues).toEqual([]);
    expect(loadIssues(db, 'P-UTG')).toEqual([]);
  });
});

describe('importer — chế độ merge và replace-subtree (§9.5)', () => {
  it('merge thêm task mới, không đụng task cũ', () => {
    const first = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const second = importTasks(
      db,
      {
        version: '1.0',
        project_code: 'UTG',
        mode: 'merge',
        tasks: [
          {
            tmp_id: 'b1',
            parent_uid: first.mapping['a1'],
            name: 'Extra',
            kind: 'work',
            effort_md: 1,
            role: 'Dev',
          },
        ],
        dependencies: [],
      },
      { runId: 'R2', now: AT },
    );
    expect(second.tasksAdded).toBe(1);
    expect(countTasks(db)).toBe(4);
    expect(second.mapping['b1']).toBe('T-0004');
  });

  it('replace-subtree xoá hết con cháu của root_uid rồi thay bằng nội dung mới', () => {
    const first = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const rootUid = first.mapping['a1'];
    importTasks(
      db,
      {
        version: '1.0',
        project_code: 'UTG',
        mode: 'replace-subtree',
        root_uid: rootUid,
        tasks: [
          {
            tmp_id: 'c1',
            parent_uid: rootUid,
            name: 'Thay the',
            kind: 'work',
            effort_md: 2,
            role: 'Dev',
          },
        ],
        dependencies: [],
      },
      { runId: 'R2', now: AT },
    );
    const names = db
      .prepare('SELECT name FROM task ORDER BY wbs_code')
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toEqual(['User management', 'Thay the']);
  });

  it('replace-subtree KHÔNG xoá chính root_uid', () => {
    const first = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const rootUid = first.mapping['a1'];
    importTasks(
      db,
      {
        version: '1.0',
        project_code: 'UTG',
        mode: 'replace-subtree',
        root_uid: rootUid,
        tasks: [],
        dependencies: [],
      },
      { runId: 'R2', now: AT },
    );
    const row = db.prepare('SELECT uid FROM task').all();
    expect(row).toEqual([{ uid: rootUid }]);
  });
});

describe('importer — tái lập được (M2)', () => {
  it('cùng payload trên DB sạch → cùng uid và cùng wbs_code', () => {
    const a = importTasks(setup(), goodPayload(), { runId: 'R1', now: AT });
    const b = importTasks(setup(), goodPayload(), { runId: 'R1', now: AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('importer — báo cáo trả về (§9.3 bước 6)', () => {
  it('trả về số task thêm, ánh xạ, và ValidationReport', () => {
    const res = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    expect(res.tasksAdded).toBe(3);
    expect(Object.keys(res.mapping).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(res.report.passed).toBe(true);
    expect(res.report.runId).toBe('R1');
    expect(res.report.counts.critical).toBe(0);
  });
});

describe('dryRunImport — xem trước cho màn S8', () => {
  function snapshot() {
    return {
      tasks: db.prepare('SELECT COUNT(*) n FROM task').get(),
      deps: db.prepare('SELECT COUNT(*) n FROM dependency').get(),
      runs: db.prepare('SELECT COUNT(*) n FROM validation_run').get(),
      issues: db.prepare('SELECT COUNT(*) n FROM validation_issue').get(),
      maxUid: db.prepare('SELECT MAX(uid) u FROM task').get(),
    };
  }

  it('trả về đúng thứ mà lần chạy thật sẽ trả', () => {
    const preview = dryRunImport(db, goodPayload(), { runId: 'DRY', now: AT });
    const real = importTasks(db, goodPayload(), { runId: 'REAL', now: AT });

    expect(preview.tasksAdded).toBe(real.tasksAdded);
    expect(preview.mapping).toEqual(real.mapping);
    expect(preview.report.counts).toEqual(real.report.counts);
  });

  it('KHÔNG để lại dấu vết nào trong DB', () => {
    const before = snapshot();
    dryRunImport(db, goodPayload(), { runId: 'DRY', now: AT });
    expect(snapshot()).toEqual(before);
  });

  it('không tiêu mất số thứ tự uid — chạy thử rồi chạy thật vẫn ra đúng uid đó', () => {
    const preview = dryRunImport(db, goodPayload(), { runId: 'DRY', now: AT });
    const real = importTasks(db, goodPayload(), { runId: 'REAL', now: AT });
    // Nếu lượt thử tiêu mất số thứ tự, lần thật sẽ bắt đầu từ T-0004 chứ không phải T-0001,
    // và bảng ánh xạ PM vừa xem trên màn hình lập tức sai.
    expect(real.mapping).toEqual(preview.mapping);
  });

  it('replace-subtree: KHÔNG xoá cây con thật', () => {
    const first = importTasks(db, goodPayload(), { runId: 'R1', now: AT });
    const rootUid = first.mapping['a1'];
    expect(rootUid).toBeDefined();
    const before = snapshot();

    dryRunImport(
      db,
      {
        version: '1.0',
        project_code: 'UTG',
        mode: 'replace-subtree',
        root_uid: rootUid,
        // Gắn vào CHÍNH `root_uid`: §9.5 chỉ xoá con cháu, `root_uid` ở lại. Thả task mới
        // ở mức gốc sẽ tạo cây hai gốc và dính C08 — đúng nhưng lạc đề của test này.
        tasks: [{ tmp_id: 'x', parent_uid: rootUid, name: 'Thay the', kind: 'summary' }],
        dependencies: [],
      },
      { runId: 'DRY', now: AT },
    );

    expect(snapshot()).toEqual(before);
  });

  it('hỏng thì ném y như lần chạy thật, và cũng không để lại gì', () => {
    const before = snapshot();
    const bad = goodPayload();
    bad.dependencies = [
      { pred: 'a2', succ: 'a3', type: 'FS', lag_days: 0 },
      { pred: 'a3', succ: 'a2', type: 'FS', lag_days: 0 },
    ];
    expect(() => dryRunImport(db, bad, { runId: 'DRY', now: AT })).toThrow(/C01/);
    expect(snapshot()).toEqual(before);
  });

  it('schema sai thì ném ngay, không đụng DB', () => {
    const before = snapshot();
    expect(() => dryRunImport(db, { version: '1.0' }, { runId: 'DRY', now: AT })).toThrow();
    expect(snapshot()).toEqual(before);
  });
});
