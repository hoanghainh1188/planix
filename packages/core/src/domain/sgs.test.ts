import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { runSgs, type SgsCluster, type SgsInput, type SgsResource, type SgsTask } from './sgs.js';
import type { DepEdge } from './dependency.js';
import { unsafeDateOnly as d } from './date-only.js';

const MON = d('2026-05-04');

function snap(resourceIds: string[], dailyCapacity = 1): CalendarSnapshot {
  return {
    calendars: [{ id: 'CAL', scope: 'location', parentId: null, weekPattern: '1111100' }],
    exceptions: [],
    locations: [{ id: 'VN', calendarId: 'CAL' }],
    resources: resourceIds.map((id) => ({
      id,
      locationId: 'VN',
      calendarId: null,
      dailyCapacity,
      availableFrom: null,
      availableTo: null,
    })),
  };
}

function task(uid: string, over: Partial<SgsTask> = {}): SgsTask {
  return {
    uid,
    wbsCode: '1',
    clusterUid: 'C1',
    kind: 'work',
    priority: 500,
    role: 'Dev',
    effortMd: 1,
    pinnedResource: null,
    constraintType: null,
    constraintDate: null,
    ls: MON,
    totalFloat: 0,
    ...over,
  };
}

function res(id: string, over: Partial<SgsResource> = {}): SgsResource {
  return { id, roles: { Dev: 1 }, maxParallel: 2, ...over };
}

function run(over: Partial<SgsInput> = {}) {
  const resources = over.resources ?? [res('R-1')];
  const clusters: readonly SgsCluster[] = over.clusters ?? [{ uid: 'C1', leafUids: ['T-1'] }];
  const tasks = over.tasks ?? [task('T-1')];
  return runSgs({
    clusters,
    tasks,
    edges: [],
    resources,
    engine: createCalendarEngine(snap(resources.map((r) => r.id))),
    calendarId: 'CAL',
    projectStart: MON,
    statusDate: MON,
    minAllocation: 0.25,
    defaultMaxParallel: 2,
    windowDays: 200,
    ...over,
  });
}

describe('runSgs — xếp một task', () => {
  it('gán đúng người và tính ngày', () => {
    const r = run();
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({
      taskUid: 'T-1',
      resourceId: 'R-1',
      allocation: 1,
      fromDate: '2026-05-04',
      toDate: '2026-05-04',
    });
    expect(r.schedule.get('T-1')).toMatchObject({ startDate: '2026-05-04', endDate: '2026-05-04' });
  });

  it('task 3 MD full-time chiếm 3 ngày làm việc', () => {
    const r = run({ tasks: [task('T-1', { effortMd: 3 })] });
    expect(r.schedule.get('T-1')).toMatchObject({ startDate: '2026-05-04', endDate: '2026-05-06' });
  });

  it('nhảy qua cuối tuần', () => {
    const r = run({ tasks: [task('T-1', { effortMd: 6 })] });
    // T2 04 den T6 08 la 5 ngay, con 1 -> T2 11
    expect(r.schedule.get('T-1')).toMatchObject({ endDate: '2026-05-11' });
  });

  it('mốc thuần effort 0 không gán người, duration 0 (§7.10)', () => {
    const r = run({
      tasks: [task('M', { kind: 'milestone', effortMd: 0, role: null })],
      clusters: [{ uid: 'C1', leafUids: ['M'] }],
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.schedule.get('M')).toMatchObject({ startDate: '2026-05-04', endDate: '2026-05-04' });
  });

  it('không sớm hơn status_date (§7.11)', () => {
    const r = run({ statusDate: d('2026-05-06') });
    expect(r.schedule.get('T-1')).toMatchObject({ startDate: '2026-05-06' });
  });
});

describe('runSgs — một task một người (§7.8)', () => {
  it('hai task cùng lúc thì người thứ nhất làm lần lượt nếu chỉ có một người', () => {
    const r = run({
      tasks: [task('T-1', { effortMd: 2 }), task('T-2', { effortMd: 2, wbsCode: '2' })],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1', { maxParallel: 1 })],
    });
    const a = r.schedule.get('T-1');
    const b = r.schedule.get('T-2');
    expect(a?.endDate).toBe('2026-05-05');
    expect(b?.startDate).toBe('2026-05-06');
  });

  it('hai người thì hai task chạy song song', () => {
    const r = run({
      tasks: [task('T-1'), task('T-2', { wbsCode: '2' })],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1'), res('R-2')],
    });
    expect(r.schedule.get('T-1')?.startDate).toBe('2026-05-04');
    expect(r.schedule.get('T-2')?.startDate).toBe('2026-05-04');
    expect(new Set(r.assignments.map((x) => x.resourceId)).size).toBe(2);
  });
});

describe('runSgs — PRIORITY_KEY quyết định ai được xếp trước (§7.4)', () => {
  it('priority 1 được xếp trước dù wbs_code lớn hơn', () => {
    const r = run({
      tasks: [
        task('T-lo', { wbsCode: '1', priority: 500, effortMd: 2 }),
        task('T-hi', { wbsCode: '9', priority: 1, effortMd: 2 }),
      ],
      clusters: [{ uid: 'C1', leafUids: ['T-lo', 'T-hi'] }],
      resources: [res('R-1', { maxParallel: 1 })],
    });
    expect(r.schedule.get('T-hi')?.startDate).toBe('2026-05-04');
    expect(r.schedule.get('T-lo')?.startDate).toBe('2026-05-06');
  });
});

describe('runSgs — pinned_resource tôn trọng tuyệt đối (§4.3, N4)', () => {
  it('gán đúng người đã pin dù người đó bận hơn', () => {
    const r = run({
      tasks: [task('T-1', { pinnedResource: 'R-2' })],
      resources: [res('R-1'), res('R-2')],
    });
    expect(r.assignments[0]).toMatchObject({ resourceId: 'R-2', isPinned: true });
  });

  it('pin vào người không có role thì vẫn gán, và sinh J01 chứ không tự đổi người', () => {
    const r = run({
      tasks: [task('T-1', { pinnedResource: 'R-2' })],
      resources: [res('R-1'), res('R-2', { roles: {} })],
    });
    expect(r.assignments[0]?.resourceId).toBe('R-2');
    expect(r.issues.some((i) => i.code === 'J01')).toBe(true);
  });
});

describe('runSgs — RESOURCE_KEY bậc 2-4 thật sự được dùng (§7.4)', () => {
  it('bậc 2: cùng ngày xong thì chọn người proficiency NHỎ hơn, không theo thứ tự mảng', () => {
    // R-slow dung TRUOC trong mang; neu khong dung RESOURCE_KEY thi no se thang.
    const r = run({
      resources: [res('R-slow', { roles: { Dev: 1.5 } }), res('R-fast', { roles: { Dev: 1 } })],
    });
    expect(r.assignments[0]?.resourceId).toBe('R-fast');
  });

  it('bậc 4: mọi bậc trên hoà thì chọn resource.id nhỏ hơn', () => {
    const r = run({ resources: [res('R-9'), res('R-1')] });
    expect(r.assignments[0]?.resourceId).toBe('R-1');
  });

  it('bậc 3: proficiency hoà thì chọn người đang gánh ít MD hơn', () => {
    // T-big chiem R-1 truoc (uid nho hon, bac 4 thang), roi T-small nen ve R-2.
    const r = run({
      tasks: [
        task('T-1', { effortMd: 4, wbsCode: '1' }),
        task('T-2', { effortMd: 1, wbsCode: '2' }),
      ],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1', { maxParallel: 1 }), res('R-2', { maxParallel: 1 })],
    });
    expect(r.assignments.find((a) => a.taskUid === 'T-2')?.resourceId).toBe('R-2');
  });
});

describe('runSgs — pin gây quá tải thì báo J01, không đổi người (§4.3, §8.2)', () => {
  it('người đã kín lịch vẫn bị ép gán, kèm J01', () => {
    const r = run({
      // Cua so 10 ngay lich tu T2 04/05 = dung 8 ngay lam viec (04-08, 11-13).
      // T-1 effort 8 chiem tron, nen R-1 khong con ngay nao cho T-2.
      tasks: [
        task('T-1', { effortMd: 8, wbsCode: '1' }),
        task('T-2', { effortMd: 1, wbsCode: '2', pinnedResource: 'R-1' }),
      ],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1', { maxParallel: 1 })],
      windowDays: 10,
    });
    const pinned = r.assignments.find((a) => a.taskUid === 'T-2');
    expect(pinned?.resourceId).toBe('R-1');
    expect(pinned?.isPinned).toBe(true);
    expect(r.issues.some((i) => i.code === 'J01' && i.severity === 'Major')).toBe(true);
  });
});

describe('runSgs — dependency trong cụm', () => {
  it('successor bắt đầu sau predecessor', () => {
    const edges: DepEdge[] = [{ predUid: 'T-1', succUid: 'T-2', type: 'FS', lagDays: 0 }];
    const r = run({
      tasks: [task('T-1', { effortMd: 2 }), task('T-2', { wbsCode: '2' })],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1'), res('R-2')],
      edges,
    });
    expect(r.schedule.get('T-1')?.endDate).toBe('2026-05-05');
    expect(r.schedule.get('T-2')?.startDate).toBe('2026-05-06');
  });

  it('phụ thuộc vòng trong cụm thì ném SchedulingDeadlock (§7.3)', () => {
    const edges: DepEdge[] = [
      { predUid: 'T-1', succUid: 'T-2', type: 'FS', lagDays: 0 },
      { predUid: 'T-2', succUid: 'T-1', type: 'FS', lagDays: 0 },
    ];
    expect(() =>
      run({
        tasks: [task('T-1'), task('T-2', { wbsCode: '2' })],
        clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
        edges,
      }),
    ).toThrow(/deadlock/i);
  });
});

describe('runSgs — không có ai đảm nhiệm được', () => {
  it('ném NoEligibleResource (§7.3)', () => {
    expect(() => run({ tasks: [task('T-1', { role: 'Designer' })] })).toThrow(/Designer/);
  });
});

describe('runSgs — delay_reason (§7.6)', () => {
  it('bị đẩy bởi predecessor thì ghi dependency kèm uid predecessor', () => {
    const edges: DepEdge[] = [{ predUid: 'T-1', succUid: 'T-2', type: 'FS', lagDays: 0 }];
    const r = run({
      tasks: [task('T-1', { effortMd: 3 }), task('T-2', { wbsCode: '2' })],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1'), res('R-2')],
      edges,
    });
    expect(r.schedule.get('T-2')).toMatchObject({
      delayReason: 'dependency',
      blockingRef: 'T-1',
    });
  });

  it('bị đẩy vì chờ người thì ghi resource kèm resource_id', () => {
    const r = run({
      tasks: [task('T-1', { effortMd: 3 }), task('T-2', { wbsCode: '2' })],
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      resources: [res('R-1', { maxParallel: 1 })],
    });
    expect(r.schedule.get('T-2')).toMatchObject({
      delayReason: 'resource',
      blockingRef: 'R-1',
    });
  });

  it('bị SNET ép thì ghi constraint', () => {
    const r = run({
      tasks: [task('T-1', { constraintType: 'SNET', constraintDate: d('2026-05-07') })],
    });
    expect(r.schedule.get('T-1')).toMatchObject({
      startDate: '2026-05-07',
      delayReason: 'constraint',
    });
  });

  it('không bị đẩy thì delay_reason rỗng', () => {
    expect(run().schedule.get('T-1')?.delayReason).toBeNull();
  });
});

describe('runSgs — tính tái lập, điều kiện của M2 (§14.2 P4)', () => {
  it('chạy 10 lần liên tiếp ra kết quả byte-for-byte giống hệt', () => {
    const build = () =>
      run({
        tasks: [
          task('T-1', { effortMd: 2, wbsCode: '1.1' }),
          task('T-2', { effortMd: 3, wbsCode: '1.2' }),
          task('T-3', { effortMd: 1, wbsCode: '1.10', priority: 100 }),
          task('T-4', { effortMd: 4, wbsCode: '1.9' }),
        ],
        clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2', 'T-3', 'T-4'] }],
        resources: [res('R-1'), res('R-2', { roles: { Dev: 1.2 } })],
      });

    const first = JSON.stringify({
      a: build().assignments,
      s: [...build().schedule.entries()],
    });
    for (let i = 0; i < 9; i++) {
      expect(JSON.stringify({ a: build().assignments, s: [...build().schedule.entries()] })).toBe(
        first,
      );
    }
  });

  it('đảo thứ tự task đầu vào không đổi kết quả', () => {
    const tasks = [
      task('T-1', { effortMd: 2, wbsCode: '1.1' }),
      task('T-2', { effortMd: 3, wbsCode: '1.2' }),
      task('T-3', { effortMd: 1, wbsCode: '1.3' }),
    ];
    const cluster: SgsCluster[] = [{ uid: 'C1', leafUids: ['T-1', 'T-2', 'T-3'] }];
    const a = run({ tasks, clusters: cluster, resources: [res('R-1')] });
    const b = run({
      tasks: [...tasks].reverse(),
      clusters: [{ uid: 'C1', leafUids: ['T-3', 'T-2', 'T-1'] }],
      resources: [res('R-1')],
    });
    expect(JSON.stringify([...a.schedule.entries()].sort())).toBe(
      JSON.stringify([...b.schedule.entries()].sort()),
    );
  });
});

/**
 * §7.6 — `delay_reason` phải gọi tên ràng buộc THẬT SỰ quyết định ngày bắt đầu.
 *
 * Trước bản sửa, nhánh đặt lý do `resource` / `cross_project` còn đòi `reason === null`.
 * Mà gần như task nào cũng có predecessor, nên `reason` đã bị `dependency` chiếm chỗ
 * trước — và hai giá trị kia **chưa bao giờ được phát ra**.
 *
 * Đo trên `data/dev.db`: trước 742 `dependency` / 0 `resource` / 0 `cross_project` / 0
 * issue `J14`; sau 412 / 251 / 79 / 79. Ngày tháng KHÔNG đổi — đây thuần là nhãn.
 *
 * §7.12 nói rõ *"Dự án ưu tiên thấp bị đẩy → issue `J14` nêu rõ dự án nào chiếm chỗ"*.
 * Với điều kiện cũ thì rule đó thực tế đã chết.
 */
describe('runSgs — delay_reason gọi tên ràng buộc BINDING (§7.6)', () => {
  /**
   * A và B cùng một người. B có predecessor A (nên `dependency` được đặt trước), nhưng
   * cái thật sự giữ B lại là NGƯỜI — A còn đang dùng.
   *
   * Nhãn đúng phải là `resource`: dời A sớm hơn cũng không giúp gì nếu người vẫn bận.
   */
  it('bị dependency đẩy RỒI bị người đẩy tiếp thì nhãn là resource', () => {
    // Ba task, MỘT người, `maxParallel: 1`.
    //
    //   T-1 (ưu tiên 1) chạy trước, chiếm ngày đầu.
    //   T-3 (ưu tiên 2) chiếm ba ngày kế — nó KHÔNG liên quan gì tới T-2.
    //   T-2 (ưu tiên 3) phụ thuộc T-1, nên cận dưới của nó là ngay sau T-1…
    //     …nhưng người thì bận T-3, nên nó phải đợi thêm ba ngày nữa.
    //
    // Dời T-1 sớm hơn không giúp gì cho T-2. Thứ giữ T-2 lại là NGƯỜI.
    const out = run({
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2', 'T-3'] }],
      tasks: [
        task('T-1', { effortMd: 1, priority: 1 }),
        task('T-3', { effortMd: 3, priority: 2 }),
        task('T-2', { effortMd: 1, priority: 3 }),
      ],
      edges: [{ predUid: 'T-1', succUid: 'T-2', type: 'FS', lagDays: 0 }],
      resources: [res('R-1', { maxParallel: 1 })],
    });

    const a = out.schedule.get('T-1');
    const b = out.schedule.get('T-2');
    expect(a && b).toBeTruthy();
    // Điều kiện của ca này: T-2 phải bắt đầu MUỘN HƠN ngay-sau-T-1. Không có chỗ này thì
    // test chẳng kiểm được gì — nó sẽ xanh kể cả khi bản sửa bị gỡ.
    expect(b?.startDate).not.toBe(a?.endDate);

    expect(b?.delayReason).toBe('resource');
    expect(b?.blockingRef).toBe('R-1');
  });

  /** Không bị đẩy thêm thì nhãn vẫn là `dependency` — bản sửa không làm mất ca đó. */
  it('chỉ bị dependency đẩy thì nhãn vẫn là dependency', () => {
    const out = run({
      clusters: [{ uid: 'C1', leafUids: ['T-1', 'T-2'] }],
      tasks: [task('T-1', { effortMd: 1 }), task('T-2', { effortMd: 1 })],
      edges: [{ predUid: 'T-1', succUid: 'T-2', type: 'FS', lagDays: 0 }],
      // Hai người: B không phải chờ ai, chỉ chờ A xong.
      resources: [res('R-1'), res('R-2')],
    });

    expect(out.schedule.get('T-2')?.delayReason).toBe('dependency');
    expect(out.schedule.get('T-2')?.blockingRef).toBe('T-1');
  });
});

/**
 * `J14` gộp theo CẶP (dự án chiếm chỗ, người) — PM chốt 2026-09-14.
 *
 * Trước đó mỗi task bị đẩy là một issue Major riêng. Sau khi `delay_reason` thôi bỏ sót,
 * `data/dev.db` sinh ra **79 issue** — đúng nhưng không đọc nổi, vì chúng lặp lại cùng
 * một câu: dự án kia đang giữ người này. Gộp lại còn **17**, và cả 79 task vẫn nằm đủ
 * trong `detail.taskUids`.
 */
describe('runSgs — J14 gộp theo cặp (dự án, người) (§7.12)', () => {
  /** Dự án khác giữ `R-1` trọn tuần đầu, nên mọi task ở đây đều bị đẩy. */
  function withHold(taskUids: readonly string[]) {
    return run({
      clusters: [{ uid: 'C1', leafUids: [...taskUids] }],
      tasks: taskUids.map((uid) => task(uid, { effortMd: 1 })),
      resources: [res('R-1', { maxParallel: 1 })],
      externalReservations: [
        {
          resourceId: 'R-1',
          fromDate: MON,
          toDate: d('2026-05-08'),
          allocation: 1,
          projectId: 'P-KHAC',
        },
      ],
      projectId: 'P-NAY',
    });
  }

  it('ba task cùng bị một dự án giữ một người ⇒ MỘT issue, không phải ba', () => {
    const j14 = withHold(['T-1', 'T-2', 'T-3']).issues.filter((i) => i.code === 'J14');
    expect(j14).toHaveLength(1);
    expect(j14[0]?.severity).toBe('Major');
  });

  it('issue nói rõ cặp nào, và đếm đúng số task', () => {
    const j14 = withHold(['T-1', 'T-2', 'T-3']).issues.filter((i) => i.code === 'J14');
    expect(j14[0]?.message).toContain('P-KHAC');
    expect(j14[0]?.message).toContain('R-1');
    expect(j14[0]?.message).toContain('3 tasks');
    expect(j14[0]?.detail?.['taskCount']).toBe(3);
  });

  /**
   * Gộp mà mất danh sách thì PM hết đường đi sâu. Thông điệp nói "đẩy 3 task", còn ba
   * uid phải nằm trong `detail` — và phải SẮP, để cùng input ra cùng chuỗi JSON (M2).
   */
  it('giữ đủ danh sách task trong detail, đã sắp', () => {
    const j14 = withHold(['T-3', 'T-1', 'T-2']).issues.filter((i) => i.code === 'J14');
    expect(j14[0]?.detail?.['taskUids']).toEqual(['T-1', 'T-2', 'T-3']);
  });

  it('một task thì dùng số ít, không phải "1 tasks"', () => {
    const j14 = withHold(['T-1']).issues.filter((i) => i.code === 'J14');
    expect(j14[0]?.message).toContain('1 task ');
  });

  it('không bị ai giữ thì không có J14 nào', () => {
    const out = run({
      clusters: [{ uid: 'C1', leafUids: ['T-1'] }],
      tasks: [task('T-1')],
      resources: [res('R-1')],
    });
    expect(out.issues.filter((i) => i.code === 'J14')).toHaveLength(0);
  });
});
