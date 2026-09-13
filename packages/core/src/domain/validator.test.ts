import { describe, expect, it } from 'vitest';
import { validate } from './validator.js';
import type {
  DependencyRow,
  ProgressRow,
  ResourceRoleRow,
  ResourceRow,
  TaskRow,
  ValidationInput,
} from './validation-types.js';

// ── helper dựng dữ liệu ──────────────────────────────────────────────────────

function task(uid: string, over: Partial<TaskRow> = {}): TaskRow {
  return {
    uid,
    projectId: 'P-UTG',
    wbsCode: '1',
    depth: 1,
    parentUid: null,
    sortOrder: 1,
    name: uid,
    kind: 'work',
    effortMd: 1,
    role: 'Dev',
    constraintType: null,
    constraintDate: null,
    ...over,
  };
}

function dep(predUid: string, succUid: string, over: Partial<DependencyRow> = {}): DependencyRow {
  return { predUid, succUid, type: 'FS', lagDays: 0, ...over };
}

function input(over: Partial<ValidationInput> = {}): ValidationInput {
  const resources: ResourceRow[] = [{ id: 'R-1', name: 'Dev A', locationId: 'VN' }];
  const resourceRoles: ResourceRoleRow[] = [{ resourceId: 'R-1', role: 'Dev' }];
  return {
    runId: 'RUN-1',
    projectId: 'P-UTG',
    tasks: [task('T-1')],
    dependencies: [],
    resources,
    resourceRoles,
    progress: [],
    dependencyMaxLevel: 3,
    ...over,
  };
}

function codes(report: { issues: readonly { code: string }[] }): string[] {
  return report.issues.map((i) => i.code).sort();
}

// ── hợp đồng đầu ra §8.4 ─────────────────────────────────────────────────────

describe('ValidationReport — hợp đồng §8.4', () => {
  it('dữ liệu sạch thì passed = true và không có issue', () => {
    const r = validate(input());
    expect(r.passed).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.counts).toEqual({ critical: 0, major: 0, minor: 0 });
    expect(r.runId).toBe('RUN-1');
    expect(r.projectId).toBe('P-UTG');
  });

  it('passed = false khi có bất kỳ Critical nào', () => {
    const r = validate(input({ tasks: [task('T-1', { role: null })] }));
    expect(r.passed).toBe(false);
    expect(r.counts.critical).toBeGreaterThan(0);
  });

  it('issue sắp xếp ổn định — chạy 2 lần ra thứ tự giống hệt (M2)', () => {
    const bad = input({
      tasks: [
        task('T-3', { role: null }),
        task('T-1', { effortMd: 0 }),
        task('T-2', { kind: 'milestone', effortMd: 5, role: null }),
      ],
    });
    expect(JSON.stringify(validate(bad))).toBe(JSON.stringify(validate(bad)));
  });
});

// ── C01 vòng lặp ─────────────────────────────────────────────────────────────

describe('C01 — vòng lặp phụ thuộc (§6.4)', () => {
  it('bắt vòng lặp 2 đỉnh và trả về ĐƯỜNG ĐI đầy đủ, không chỉ báo "có cycle"', () => {
    const r = validate(
      input({
        tasks: [task('A'), task('B')],
        dependencies: [dep('A', 'B'), dep('B', 'A')],
      }),
    );
    const c01 = r.issues.find((i) => i.code === 'C01');
    expect(c01?.severity).toBe('Critical');
    const path = c01?.detail?.['path'] as string[] | undefined;
    expect(path).toBeDefined();
    // duong di dong: dinh dau lap lai o cuoi
    expect(path?.[0]).toBe(path?.[path.length - 1]);
    expect(path?.length).toBeGreaterThanOrEqual(3);
  });

  it('bắt vòng lặp 3 đỉnh', () => {
    const r = validate(
      input({
        tasks: [task('A'), task('B'), task('C')],
        dependencies: [dep('A', 'B'), dep('B', 'C'), dep('C', 'A')],
      }),
    );
    expect(codes(r)).toContain('C01');
  });

  it('SS + FF giữa CÙNG hai task là hợp lệ, KHÔNG được báo nhầm (§6.4)', () => {
    const r = validate(
      input({
        tasks: [task('A'), task('B')],
        dependencies: [dep('A', 'B', { type: 'SS' }), dep('A', 'B', { type: 'FF' })],
      }),
    );
    expect(codes(r)).not.toContain('C01');
  });

  it('đồ thị kim cương (không vòng lặp) không bị báo nhầm', () => {
    const r = validate(
      input({
        tasks: [task('A'), task('B'), task('C'), task('D')],
        dependencies: [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')],
      }),
    );
    expect(codes(r)).not.toContain('C01');
  });
});

// ── C02, C03, C08 cấu trúc cây ───────────────────────────────────────────────

describe('C02 / C03 / C08 — cấu trúc', () => {
  it('C02: parent_uid trỏ tới uid không tồn tại', () => {
    const r = validate(input({ tasks: [task('T-1', { parentUid: 'KHONG-CO' })] }));
    expect(codes(r)).toContain('C02');
  });

  it('C03: dependency trỏ tới uid không tồn tại', () => {
    const r = validate(input({ tasks: [task('A')], dependencies: [dep('A', 'KHONG-CO')] }));
    expect(codes(r)).toContain('C03');
  });

  it('C08: nhiều hơn 1 gốc', () => {
    const r = validate(input({ tasks: [task('A'), task('B')] }));
    expect(codes(r)).toContain('C08');
  });

  it('C08: task tự làm cha chính nó', () => {
    const r = validate(input({ tasks: [task('A', { parentUid: 'A' })] }));
    expect(codes(r)).toContain('C08');
  });

  it('một gốc + con thì KHÔNG báo C08', () => {
    const r = validate(
      input({
        tasks: [
          task('A', { kind: 'summary', effortMd: null, role: null }),
          task('B', { parentUid: 'A', depth: 2 }),
        ],
      }),
    );
    expect(codes(r)).not.toContain('C08');
  });
});

// ── C04, C05, C07, C09, C10 ──────────────────────────────────────────────────

describe('C04 / C05 / C07 / C09 / C10 — task và nhân sự', () => {
  it('C04: task work không có role', () => {
    expect(codes(validate(input({ tasks: [task('A', { role: null })] })))).toContain('C04');
  });

  it('C05: role không ai đảm nhiệm được', () => {
    expect(codes(validate(input({ tasks: [task('A', { role: 'Designer' })] })))).toContain('C05');
  });

  it('C05 xét pool TOÀN CỤC, không lọc theo dự án (§7.12)', () => {
    // Resource khong thuoc du an nao — pool la toan cuc, nen van dam nhiem duoc.
    const r = validate(
      input({
        tasks: [task('A', { role: 'QA' })],
        resources: [{ id: 'R-9', name: 'QA toan cuc', locationId: 'JP' }],
        resourceRoles: [{ resourceId: 'R-9', role: 'QA' }],
      }),
    );
    expect(codes(r)).not.toContain('C05');
  });

  it('C07: work có effort_md = 0 / âm / null', () => {
    for (const effortMd of [0, -1, null]) {
      expect(codes(validate(input({ tasks: [task('A', { effortMd })] })))).toContain('C07');
    }
  });

  it('C07: milestone effort_md âm bị bắt, nhưng = 0 thì hợp lệ (mốc thuần §7.10)', () => {
    const neg = validate(
      input({ tasks: [task('A', { kind: 'milestone', effortMd: -1, role: null })] }),
    );
    expect(codes(neg)).toContain('C07');
    const zero = validate(
      input({ tasks: [task('A', { kind: 'milestone', effortMd: 0, role: null })] }),
    );
    expect(codes(zero)).not.toContain('C07');
  });

  it('C09: milestone có effort > 0 nhưng thiếu role', () => {
    const r = validate(
      input({ tasks: [task('A', { kind: 'milestone', effortMd: 3, role: null })] }),
    );
    expect(codes(r)).toContain('C09');
  });

  it('C10: resource không có location_id', () => {
    const r = validate(
      input({
        resources: [{ id: 'R-1', name: 'Dev A', locationId: null }],
      }),
    );
    expect(codes(r)).toContain('C10');
  });

  it('summary không cần role và không cần effort', () => {
    const r = validate(
      input({
        tasks: [
          task('A', { kind: 'summary', effortMd: null, role: null }),
          task('B', { parentUid: 'A', depth: 2 }),
        ],
      }),
    );
    expect(codes(r)).not.toContain('C04');
    expect(codes(r)).not.toContain('C07');
  });
});

// ── C11 tiến độ ──────────────────────────────────────────────────────────────

describe('C11 — done phải có actual_start và actual_end', () => {
  const base = (p: Partial<ProgressRow>): ValidationInput =>
    input({
      tasks: [task('A')],
      progress: [
        {
          taskUid: 'A',
          status: 'done',
          percent: 100,
          actualStart: '2026-01-01',
          actualEnd: '2026-01-02',
          ...p,
        },
      ],
    });

  it('thiếu actual_start', () => {
    expect(codes(validate(base({ actualStart: null })))).toContain('C11');
  });

  it('thiếu actual_end', () => {
    expect(codes(validate(base({ actualEnd: null })))).toContain('C11');
  });

  it('đủ cả hai thì không báo', () => {
    expect(codes(validate(base({})))).not.toContain('C11');
  });

  it('status khác done thì không áp dụng', () => {
    const r = validate(
      input({
        tasks: [task('A')],
        progress: [
          {
            taskUid: 'A',
            status: 'in_progress',
            percent: 50,
            actualStart: null,
            actualEnd: null,
          },
        ],
      }),
    );
    expect(codes(r)).not.toContain('C11');
  });
});

// ── C12 cấp khai báo dependency ──────────────────────────────────────────────

describe('C12 — dependency khai ở task sâu hơn dependency_max_level (§6.2)', () => {
  // Hai cha KHÁC nhau: §6.3 miễn trừ cạnh giữa anh em cùng cha, nên muốn chạm C12 thì
  // hai đầu phải nằm ở hai nhánh khác nhau.
  const tasks = [
    task('R', { kind: 'summary', effortMd: null, role: null, depth: 1 }),
    task('M1', { parentUid: 'R', kind: 'summary', effortMd: null, role: null, depth: 3 }),
    task('M2', { parentUid: 'R', kind: 'summary', effortMd: null, role: null, depth: 3 }),
    task('D4a', { parentUid: 'M1', depth: 4 }),
    task('D4b', { parentUid: 'M2', depth: 4 }),
    task('D3a', { parentUid: 'R', depth: 3 }),
    task('D3b', { parentUid: 'R', depth: 3 }),
  ];

  it('bắt khi hai đầu sâu quá mức và KHÁC cha', () => {
    const r = validate(input({ tasks, dependencies: [dep('D4a', 'D4b')] }));
    expect(codes(r)).toContain('C12');
  });

  it('MIỄN TRỪ cạnh giữa hai anh em cùng cha — §6.3 "Cách 2" cho phép', () => {
    const siblings = [
      task('R', { kind: 'summary', effortMd: null, role: null, depth: 1 }),
      task('M1', { parentUid: 'R', kind: 'summary', effortMd: null, role: null, depth: 3 }),
      task('s1', { parentUid: 'M1', depth: 4 }),
      task('s2', { parentUid: 'M1', depth: 4 }),
    ];
    const r = validate(input({ tasks: siblings, dependencies: [dep('s1', 's2')] }));
    expect(codes(r)).not.toContain('C12');
  });

  it('không bắt khi ở đúng mức cho phép', () => {
    const r = validate(input({ tasks, dependencies: [dep('D3a', 'D3b')] }));
    expect(codes(r)).not.toContain('C12');
  });

  it('tôn trọng dependency_max_level của dự án, không hardcode 3', () => {
    const r = validate(input({ tasks, dependencies: [dep('D4a', 'D4b')], dependencyMaxLevel: 4 }));
    expect(codes(r)).not.toContain('C12');
  });
});

// ── C06 mức cấu trúc (quyết định 2026-09-12-c06-partial-at-p1) ───────────────

describe('C06 — MSO xung đột, mức cấu trúc ở P1', () => {
  it('MSO thiếu constraint_date', () => {
    const r = validate(
      input({ tasks: [task('A', { constraintType: 'MSO', constraintDate: null })] }),
    );
    expect(codes(r)).toContain('C06');
  });

  it('MSO đặt trên summary — ngày của summary là rollup từ con (§7.7)', () => {
    const r = validate(
      input({
        tasks: [
          task('A', {
            kind: 'summary',
            effortMd: null,
            role: null,
            constraintType: 'MSO',
            constraintDate: '2026-03-01',
          }),
          task('B', { parentUid: 'A', depth: 2 }),
        ],
      }),
    );
    expect(codes(r)).toContain('C06');
  });

  it('FS: MSO của successor sớm hơn MSO của predecessor + lag → không thoả được', () => {
    const r = validate(
      input({
        tasks: [
          task('R', { kind: 'summary', effortMd: null, role: null }),
          task('A', {
            parentUid: 'R',
            depth: 2,
            constraintType: 'MSO',
            constraintDate: '2026-03-10',
          }),
          task('B', {
            parentUid: 'R',
            depth: 2,
            constraintType: 'MSO',
            constraintDate: '2026-03-05',
          }),
        ],
        dependencies: [dep('A', 'B')],
      }),
    );
    expect(codes(r)).toContain('C06');
  });

  it('FS: MSO successor muộn hơn thì KHÔNG báo — phần còn lại để P3 (cần CPM)', () => {
    const r = validate(
      input({
        tasks: [
          task('R', { kind: 'summary', effortMd: null, role: null }),
          task('A', {
            parentUid: 'R',
            depth: 2,
            constraintType: 'MSO',
            constraintDate: '2026-03-01',
          }),
          task('B', {
            parentUid: 'R',
            depth: 2,
            constraintType: 'MSO',
            constraintDate: '2026-03-20',
          }),
        ],
        dependencies: [dep('A', 'B')],
      }),
    );
    expect(codes(r)).not.toContain('C06');
  });
});
