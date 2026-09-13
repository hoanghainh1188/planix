/**
 * Dữ liệu mẫu để dựng và soi giao diện.
 *
 * Chưa có HTTP adapter nối tRPC router (P7 mới chạy qua `createCaller`), nên màn hình
 * lấy dữ liệu từ đây. Sinh tất định, không random: mở lại hai lần phải thấy y hệt, nếu
 * không thì mọi so sánh ảnh chụp màn hình đều vô nghĩa.
 *
 * Thay bằng lời gọi tRPC thật khi adapter sẵn sàng — chỉ cần đổi một chỗ, vì component
 * chỉ biết tới kiểu trong `types.ts`.
 */

import type { IssueRow, ProjectSummary, WbsRow } from './types.js';

export const PROJECTS: ProjectSummary[] = [
  { id: 'P-UTG', code: 'UTG', name: 'UTG リニューアル', role: 'pm' },
  { id: 'P-GEO', code: 'GEO', name: 'GEO 配車システム', role: 'lead' },
];

const ROLES = ['BrSE', 'Dev', 'QA', 'Designer', 'TechLead'];
const PHASES = ['要件定義', '基本設計', '詳細設計', '実装', 'テスト'];
const PEOPLE = ['Nguyen A', 'Tran B', 'Le C', 'Pham D', 'Hoang E', 'Vu F'];
const EFFORTS = [0.25, 0.5, 1, 2, 0.5, 3, 0.25, 1.5];

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Cây 4 cấp cỡ thật để kiểm cuộn: 5 phase × 8 module × ~150 task lá. */
export function buildMockTree(leafTarget = 6000): WbsRow[] {
  const rows: WbsRow[] = [];
  const start = '2026-01-05';
  let cursor = 0;

  rows.push({
    uid: 'T-0001',
    wbsCode: '1',
    depth: 1,
    parentUid: null,
    name: 'UTG リニューアル',
    kind: 'summary',
    effortMd: null,
    role: null,
    childSequencing: 'sequential',
    pic: null,
    status: 'in_progress',
    percent: 34.2,
    planStart: start,
    planEnd: addDays(start, 640),
    totalFloat: 0,
    isCritical: true,
    delayReason: null,
    issueCodes: [],
  });

  const modulesPerPhase = 8;
  const leavesPerModule = Math.max(1, Math.floor(leafTarget / (PHASES.length * modulesPerPhase)));
  let seq = 2;

  PHASES.forEach((phase, p) => {
    const phaseUid = `T-${String(seq++).padStart(4, '0')}`;
    rows.push({
      uid: phaseUid,
      wbsCode: `1.${p + 1}`,
      depth: 2,
      parentUid: 'T-0001',
      name: phase,
      kind: 'summary',
      effortMd: null,
      role: null,
      childSequencing: p % 2 === 0 ? 'sequential' : 'parallel',
      pic: null,
      status: p === 0 ? 'done' : p === 1 ? 'in_progress' : 'not_started',
      percent: p === 0 ? 100 : p === 1 ? 48 : 0,
      planStart: addDays(start, p * 120),
      planEnd: addDays(start, (p + 1) * 120),
      totalFloat: p === 4 ? 12 : 0,
      isCritical: p !== 4,
      delayReason: null,
      issueCodes: [],
    });

    for (let m = 0; m < modulesPerPhase; m++) {
      const moduleUid = `T-${String(seq++).padStart(4, '0')}`;
      rows.push({
        uid: moduleUid,
        wbsCode: `1.${p + 1}.${m + 1}`,
        depth: 3,
        parentUid: phaseUid,
        name: `Module ${m + 1}`,
        kind: 'summary',
        effortMd: null,
        role: null,
        childSequencing: (p + m) % 3 === 0 ? 'sequential' : 'parallel',
        pic: null,
        status: p === 0 ? 'done' : 'not_started',
        percent: p === 0 ? 100 : 0,
        planStart: addDays(start, p * 120 + m * 12),
        planEnd: addDays(start, p * 120 + (m + 1) * 12),
        totalFloat: (p + m) % 5,
        isCritical: (p + m) % 4 === 0,
        delayReason: null,
        issueCodes: [],
      });

      for (let i = 0; i < leavesPerModule; i++) {
        const uid = `T-${String(seq++).padStart(4, '0')}`;
        const effort = EFFORTS[cursor % EFFORTS.length] ?? 1;
        const isMilestone = cursor % 97 === 96;
        const status =
          p === 0
            ? 'done'
            : cursor % 11 === 0
              ? 'blocked'
              : cursor % 5 === 0
                ? 'in_progress'
                : 'not_started';
        rows.push({
          uid,
          wbsCode: `1.${p + 1}.${m + 1}.${i + 1}`,
          depth: 4,
          parentUid: moduleUid,
          name: isMilestone ? `マイルストーン ${cursor}` : `${phase} タスク ${i + 1}`,
          kind: isMilestone ? 'milestone' : 'work',
          effortMd: isMilestone ? 0 : effort,
          role: ROLES[cursor % ROLES.length] ?? 'Dev',
          childSequencing: null,
          pic: isMilestone ? null : (PEOPLE[cursor % PEOPLE.length] ?? null),
          status,
          percent: status === 'done' ? 100 : status === 'in_progress' ? 40 : 0,
          planStart: addDays(start, p * 120 + m * 12 + (i % 12)),
          planEnd: addDays(start, p * 120 + m * 12 + (i % 12) + Math.ceil(effort)),
          totalFloat: cursor % 7,
          isCritical: cursor % 13 === 0,
          delayReason: cursor % 17 === 0 ? 'resource' : cursor % 23 === 0 ? 'cross_project' : null,
          issueCodes: cursor % 31 === 0 ? ['J05'] : cursor % 53 === 0 ? ['N03'] : [],
        });
        cursor++;
      }
    }
  });

  return rows;
}

export function buildMockIssues(rows: readonly WbsRow[]): IssueRow[] {
  const out: IssueRow[] = [
    {
      severity: 'Major',
      code: 'J07',
      taskUid: null,
      message: 'Phase A vs phase B gap is 24%; resourcing is significantly short.',
    },
    {
      severity: 'Major',
      code: 'J14',
      taskUid: null,
      message: 'Project GEO holds R-03; 18 tasks were pushed.',
    },
    {
      severity: 'Minor',
      code: 'N01',
      taskUid: null,
      message: 'SF is rarely correct. Did you mean FS?',
    },
  ];
  for (const row of rows) {
    for (const code of row.issueCodes) {
      out.push({
        severity: code.startsWith('J') ? 'Major' : 'Minor',
        code,
        taskUid: row.uid,
        message:
          code === 'J05'
            ? 'Task larger than 10 MD has not been broken down.'
            : 'Leaf task has no phase or module.',
      });
    }
  }
  return out;
}
