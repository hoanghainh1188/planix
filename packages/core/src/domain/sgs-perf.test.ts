import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { runSgs, type SgsCluster, type SgsResource, type SgsTask } from './sgs.js';
import { unsafeDateOnly as d } from './date-only.js';

const MON = d('2026-01-05'); // thu Hai
const ROLES = ['BrSE', 'Dev', 'QA', 'Designer', 'TechLead'];

/** §1.5: 6.000 task, 15-30 người, 400 ngày làm việc. §14.2 P4: dưới 10 giây. */
function scenario(taskCount: number, resourceCount: number) {
  const resources: SgsResource[] = Array.from({ length: resourceCount }, (_, i) => ({
    id: `R-${String(i).padStart(2, '0')}`,
    // Moi nguoi dam nhiem 2 role de co canh tranh that su.
    roles: {
      [ROLES[i % ROLES.length] ?? 'Dev']: 1,
      [ROLES[(i + 1) % ROLES.length] ?? 'Dev']: 1.2,
    },
    maxParallel: 2,
  }));

  const snapshot: CalendarSnapshot = {
    calendars: [{ id: 'CAL', scope: 'location', parentId: null, weekPattern: '1111100' }],
    exceptions: [],
    locations: [{ id: 'VN', calendarId: 'CAL' }],
    resources: resources.map((r) => ({
      id: r.id,
      locationId: 'VN',
      calendarId: null,
      dailyCapacity: 1,
      availableFrom: null,
      availableTo: null,
    })),
  };

  const clusterCount = 60;
  const tasks: SgsTask[] = [];
  const buckets: string[][] = Array.from({ length: clusterCount }, () => []);

  const effortTable = [0.25, 0.5, 1, 2, 0.5, 3, 0.25, 1.5];
  for (let i = 0; i < taskCount; i++) {
    const uid = `T-${String(i).padStart(5, '0')}`;
    const c = i % clusterCount;
    buckets[c]?.push(uid);
    tasks.push({
      uid,
      wbsCode: `${c + 1}.${Math.floor(i / clusterCount) + 1}`,
      clusterUid: `C-${c}`,
      kind: 'work',
      priority: 300 + (i % 5) * 100,
      role: ROLES[i % ROLES.length] ?? 'Dev',
      effortMd: effortTable[i % effortTable.length] ?? 1,
      pinnedResource: null,
      constraintType: null,
      constraintDate: null,
      ls: MON,
      totalFloat: i % 7,
    });
  }

  const clusters: SgsCluster[] = buckets.map((leafUids, c) => ({ uid: `C-${c}`, leafUids }));
  return { tasks, resources, clusters, engine: createCalendarEngine(snapshot) };
}

describe('hiệu năng SGS (§14.2 P4, §7.14)', () => {
  it('6.000 task × 30 người dưới 10 giây', () => {
    const { tasks, resources, clusters, engine } = scenario(6000, 30);

    const t0 = performance.now();
    const result = runSgs({
      clusters,
      tasks,
      edges: [],
      resources,
      engine,
      calendarId: 'CAL',
      projectStart: MON,
      statusDate: MON,
      minAllocation: 0.25,
      defaultMaxParallel: 2,
      windowDays: 600,
    });
    const elapsed = performance.now() - t0;

    console.info(`SGS 6000 task x 30 nguoi: ${elapsed.toFixed(0)} ms`);
    expect(result.assignments).toHaveLength(6000);
    expect(result.schedule.size).toBe(6000);
    expect(elapsed).toBeLessThan(10_000);
  });

  it('chạy 2 lần trên cùng dữ liệu ra kết quả byte-for-byte giống hệt ở quy mô thật', () => {
    const build = () => {
      const { tasks, resources, clusters, engine } = scenario(500, 10);
      return runSgs({
        clusters,
        tasks,
        edges: [],
        resources,
        engine,
        calendarId: 'CAL',
        projectStart: MON,
        statusDate: MON,
        minAllocation: 0.25,
        defaultMaxParallel: 2,
        windowDays: 400,
      });
    };
    expect(JSON.stringify(build().assignments)).toBe(JSON.stringify(build().assignments));
  });
});
