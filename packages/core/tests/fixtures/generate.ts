/**
 * Sinh fixture tất định cho golden test (SPEC.md §14.5, CLAUDE.md §4).
 *
 * KHÔNG dùng random: cùng `taskCount` luôn cho cùng cây, byte-for-byte. Mọi "ngẫu
 * nhiên" ở đây là hàm của chỉ số, nên tái lập được trên mọi máy.
 *
 * Cây sinh ra cố ý chứa các tình huống CLAUDE.md §4 liệt kê:
 *   - đủ bốn loại dependency FS / SS / FF / SF, có cả lag âm
 *   - cụm `parallel` lẫn `sequential`
 *   - micro task (<= 0.5 MD) lẫn task thường
 *   - dependency chỉ khai ở depth <= 3 (nếu không sẽ dính C12)
 *
 * Các tình huống còn lại của §4 — task bị hủy giữa chuỗi, người làm nhiều dự án,
 * lễ VN chồng nghỉ phép, pinned_resource gây overallocate — cần bảng progress,
 * calendar và assignment, tức cần P2/P4/P5. Sẽ bổ sung vào fixture ở phase đó.
 */

export const ROLES = ['BrSE', 'Dev', 'QA', 'Designer', 'TechLead'] as const;

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

export interface FixtureTask {
  tmp_id: string;
  parent_tmp_id: string | null;
  name: string;
  kind: 'summary' | 'work' | 'milestone';
  effort_md?: number;
  role?: string;
  phase?: string;
  module?: string;
  category?: string;
  priority?: number;
  child_sequencing?: 'parallel' | 'sequential';
}

export interface FixtureDependency {
  pred: string;
  succ: string;
  type: (typeof DEP_TYPES)[number];
  lag_days: number;
}

export interface FixturePayload {
  version: '1.0';
  project_code: string;
  mode: 'merge';
  tasks: FixtureTask[];
  dependencies: FixtureDependency[];
}

/** Effort tất định theo chỉ số: trộn micro task với task thường. */
function effortFor(i: number): number {
  const table = [0.25, 0.5, 1, 2, 0.5, 3, 0.25, 5, 1.5, 8];
  return table[i % table.length] ?? 1;
}

export function buildPayload(taskCount: number, projectCode = 'UTG'): FixturePayload {
  if (taskCount < 4) throw new Error('taskCount must be at least 4');

  const tasks: FixtureTask[] = [];
  const dependencies: FixtureDependency[] = [];

  // depth 1 — đúng một gốc, nếu không sẽ dính C08.
  tasks.push({
    tmp_id: 'root',
    parent_tmp_id: null,
    name: 'Project root',
    kind: 'summary',
    child_sequencing: 'sequential',
  });

  // Chia còn lại thành: phase (depth 2) → module (depth 3) → task lá (depth 4).
  const remaining = taskCount - 1;
  const phaseCount = Math.max(2, Math.min(6, Math.floor(Math.sqrt(remaining) / 2)));
  const modulesPerPhase = Math.max(2, Math.floor(Math.sqrt(remaining) / 2));
  const summaryCount = phaseCount + phaseCount * modulesPerPhase;
  const leafCount = remaining - summaryCount;
  if (leafCount < 1) throw new Error(`taskCount ${taskCount} too small for the shape`);

  const phaseIds: string[] = [];
  const moduleIds: string[] = [];

  for (let p = 0; p < phaseCount; p++) {
    const pid = `ph${p}`;
    phaseIds.push(pid);
    tasks.push({
      tmp_id: pid,
      parent_tmp_id: 'root',
      name: `Phase ${p + 1}`,
      kind: 'summary',
      phase: `P${p + 1}`,
      // Xen kẽ để fixture có cả hai kiểu cụm (§6.3).
      child_sequencing: p % 2 === 0 ? 'sequential' : 'parallel',
    });

    for (let m = 0; m < modulesPerPhase; m++) {
      const mid = `ph${p}m${m}`;
      moduleIds.push(mid);
      tasks.push({
        tmp_id: mid,
        parent_tmp_id: pid,
        name: `Module ${p + 1}.${m + 1}`,
        kind: 'summary',
        phase: `P${p + 1}`,
        module: `mod-${p}-${m}`,
        child_sequencing: (p + m) % 3 === 0 ? 'sequential' : 'parallel',
      });
    }
  }

  // Task lá rải đều vào các module, vòng tròn cho tất định.
  for (let i = 0; i < leafCount; i++) {
    const mid = moduleIds[i % moduleIds.length];
    if (mid === undefined) break;
    const isMilestone = i % 97 === 96;
    const role = ROLES[i % ROLES.length] ?? 'Dev';

    if (isMilestone) {
      // Mốc thuần: effort 0, không cần role (§7.10). effort > 0 mà thiếu role là C09.
      tasks.push({
        tmp_id: `t${i}`,
        parent_tmp_id: mid,
        name: `Milestone ${i}`,
        kind: 'milestone',
        effort_md: 0,
        category: 'Milestone',
        priority: 100,
      });
    } else {
      tasks.push({
        tmp_id: `t${i}`,
        parent_tmp_id: mid,
        name: `Task ${i}`,
        kind: 'work',
        effort_md: effortFor(i),
        role,
        category: i % 2 === 0 ? 'UI' : 'Logic',
        priority: 300 + (i % 5) * 100,
      });
    }
  }

  // Dependency CHỈ khai ở depth <= 3 (§6.2). Phase là depth 2, module là depth 3.
  // Khai ở task lá (depth 4) sẽ dính C12.
  for (let p = 1; p < phaseIds.length; p++) {
    const prev = phaseIds[p - 1];
    const cur = phaseIds[p];
    if (prev === undefined || cur === undefined) continue;
    const type = DEP_TYPES[p % DEP_TYPES.length] ?? 'FS';
    // Lag âm ở một số cạnh để fixture phủ cả lead (§6.1).
    const lag = p % 3 === 0 ? -1 : p % 2 === 0 ? 2 : 0;
    dependencies.push({ pred: prev, succ: cur, type, lag_days: lag });
  }

  for (let m = 1; m < moduleIds.length; m++) {
    if (m % 2 === 1) continue; // thưa bớt cho giống thật
    const prev = moduleIds[m - 1];
    const cur = moduleIds[m];
    if (prev === undefined || cur === undefined) continue;
    dependencies.push({ pred: prev, succ: cur, type: 'FS', lag_days: 0 });
  }

  return { version: '1.0', project_code: projectCode, mode: 'merge', tasks, dependencies };
}
