/**
 * Rule Validator — SPEC.md §8.
 *
 * P1 cài đặt đủ mức Critical `C01`–`C12` (§8.1). Mức Major/Minor thuộc các phase sau,
 * khi đã có lịch để đối chiếu.
 *
 * `C06` ở đây là **mức cấu trúc**, không phải mức đầy đủ — xem
 * `docs/decisions/2026-09-12-c06-partial-at-p1.md`. Mức đầy đủ cần forward pass của
 * CPM, là P3.
 *
 * Hàm thuần: nhận ảnh chụp dữ liệu, trả báo cáo. Không đọc DB (CLAUDE.md §3).
 */

import type {
  DependencyRow,
  TaskRow,
  ValidationInput,
  ValidationIssue,
  ValidationReport,
} from './validation-types.js';

export function validate(input: ValidationInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const byUid = new Map(input.tasks.map((t) => [t.uid, t]));

  checkTreeStructure(input, byUid, issues);
  checkTaskFields(input, issues);
  checkResources(input, issues);
  checkDependencyRefs(input, byUid, issues);
  checkDependencyLevel(input, byUid, issues);
  checkCycles(input, byUid, issues);
  checkMsoStructural(input, byUid, issues);
  checkProgress(input, byUid, issues);

  // Sắp ổn định. Thiếu bước này thì thứ tự issue phụ thuộc thứ tự chạy rule và thứ tự
  // dòng trả về từ DB — cùng input ra hai báo cáo khác nhau, M2 sụp.
  const sorted = [...issues].sort(compareIssues);

  const counts = {
    critical: sorted.filter((i) => i.severity === 'Critical').length,
    major: sorted.filter((i) => i.severity === 'Major').length,
    minor: sorted.filter((i) => i.severity === 'Minor').length,
  };

  return {
    runId: input.runId,
    projectId: input.projectId,
    passed: counts.critical === 0,
    counts,
    issues: sorted,
  };
}

function compareIssues(a: ValidationIssue, b: ValidationIssue): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const au = a.taskUid ?? '';
  const bu = b.taskUid ?? '';
  if (au !== bu) return au < bu ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

function critical(
  code: string,
  message: string,
  task?: TaskRow,
  detail?: Record<string, unknown>,
): ValidationIssue {
  const issue: ValidationIssue = { severity: 'Critical', code, message };
  return {
    ...issue,
    ...(task === undefined ? {} : { taskUid: task.uid, wbsCode: task.wbsCode }),
    ...(detail === undefined ? {} : { detail }),
  };
}

// ── C02, C08 — cấu trúc cây ─────────────────────────────────────────────────

function checkTreeStructure(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  let roots = 0;

  for (const t of input.tasks) {
    if (t.parentUid === null) {
      roots++;
      continue;
    }
    if (t.parentUid === t.uid) {
      issues.push(critical('C08', `Task ${t.uid} is its own parent.`, t));
      continue;
    }
    if (!byUid.has(t.parentUid)) {
      issues.push(
        critical('C02', `parent_uid ${t.parentUid} does not exist.`, t, {
          parentUid: t.parentUid,
        }),
      );
    }
  }

  if (input.tasks.length === 0) return;

  if (roots > 1) {
    issues.push(
      critical('C08', `WBS tree has ${roots} roots; exactly one is required.`, undefined, {
        roots,
      }),
    );
  } else if (roots === 0) {
    // Không gốc nào mà vẫn có task: chuỗi cha-con khép thành vòng.
    issues.push(critical('C08', 'WBS tree has no root; parent chain forms a cycle.'));
  }
}

// ── C04, C07, C09 — trường của task ─────────────────────────────────────────

function checkTaskFields(input: ValidationInput, issues: ValidationIssue[]): void {
  for (const t of input.tasks) {
    if (t.kind === 'work') {
      if (t.role === null || t.role === '') {
        issues.push(critical('C04', `Work task ${t.uid} has no role.`, t));
      }
      if (t.effortMd === null || t.effortMd <= 0) {
        issues.push(
          critical('C07', `Work task ${t.uid} must have effort_md > 0.`, t, {
            effortMd: t.effortMd,
          }),
        );
      }
    }

    if (t.kind === 'milestone') {
      // Mốc thuần có effort 0 là hợp lệ; chỉ số âm mới sai (§7.10).
      if (t.effortMd !== null && t.effortMd < 0) {
        issues.push(
          critical('C07', `Milestone ${t.uid} has negative effort_md.`, t, {
            effortMd: t.effortMd,
          }),
        );
      }
      if (t.effortMd !== null && t.effortMd > 0 && (t.role === null || t.role === '')) {
        issues.push(critical('C09', `Milestone ${t.uid} has effort_md > 0 but no role.`, t));
      }
    }
  }
}

// ── C05, C10 — nhân sự ──────────────────────────────────────────────────────

function checkResources(input: ValidationInput, issues: ValidationIssue[]): void {
  for (const r of input.resources) {
    if (r.locationId === null || r.locationId === '') {
      issues.push(
        critical('C10', `Resource ${r.id} has no location_id.`, undefined, {
          resourceId: r.id,
        }),
      );
    }
  }

  // Pool nhân sự là TOÀN CỤC (§7.12). Không lọc theo dự án — một người làm nhiều dự án.
  const coveredRoles = new Set(input.resourceRoles.map((rr) => rr.role));

  // Gom theo role để mỗi role thiếu người chỉ báo một lần, kèm danh sách task ảnh hưởng.
  const missing = new Map<string, string[]>();
  for (const t of input.tasks) {
    if (t.role === null || t.role === '') continue;
    if (coveredRoles.has(t.role)) continue;
    const list = missing.get(t.role);
    if (list === undefined) missing.set(t.role, [t.uid]);
    else list.push(t.uid);
  }

  for (const [role, uids] of [...missing.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    issues.push(
      critical('C05', `No resource can perform role "${role}".`, undefined, {
        role,
        taskUids: [...uids].sort(),
      }),
    );
  }
}

// ── C03 — dependency trỏ tới uid không tồn tại ──────────────────────────────

function checkDependencyRefs(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  for (const d of input.dependencies) {
    for (const [side, uid] of [
      ['pred_uid', d.predUid],
      ['succ_uid', d.succUid],
    ] as const) {
      if (!byUid.has(uid)) {
        issues.push(
          critical('C03', `Dependency ${side} ${uid} does not exist.`, undefined, {
            predUid: d.predUid,
            succUid: d.succUid,
            type: d.type,
          }),
        );
      }
    }
  }
}

// ── C12 — cấp khai báo dependency (§6.2) ────────────────────────────────────

function checkDependencyLevel(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  for (const d of input.dependencies) {
    const pred = byUid.get(d.predUid);
    const succ = byUid.get(d.succUid);

    // §6.3 "Cách 2 — cạnh tường minh" cho phép hai task lá CÙNG CHA nối trực tiếp với
    // nhau, dùng cho ngoại lệ trong một cụm. Task lá luôn sâu hơn dependency_max_level,
    // nên C12 hiểu theo nghĩa đen sẽ cấm đúng thứ §6.3 vừa cho phép — và "Cách 2" trở
    // thành điều khoản không dùng được.
    //
    // Miễn trừ cặp cùng cha. Cạnh sâu mà KHÁC cha vẫn là C12: đó mới là thứ §6.2 muốn
    // chặn, vì nó vượt ra ngoài cụm và phá cơ chế xếp lịch theo cụm.
    //
    // Xem docs/decisions/2026-09-13-c12-vs-sibling-edges.md
    const sameParent =
      pred !== undefined &&
      succ !== undefined &&
      pred.parentUid !== null &&
      pred.parentUid === succ.parentUid;
    if (sameParent) continue;

    for (const uid of [d.predUid, d.succUid]) {
      const t = byUid.get(uid);
      if (t === undefined) continue; // đã báo C03
      if (t.depth > input.dependencyMaxLevel) {
        issues.push(
          critical(
            'C12',
            `Dependency declared on task at depth ${t.depth}, above dependency_max_level ${input.dependencyMaxLevel}.`,
            t,
            { depth: t.depth, maxLevel: input.dependencyMaxLevel },
          ),
        );
      }
    }
  }
}

// ── C01 — vòng lặp phụ thuộc, DFS ba màu (§6.4) ─────────────────────────────

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

function checkCycles(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  // Chỉ lấy cạnh mà cả hai đầu đều tồn tại — đầu hỏng đã báo C03.
  //
  // Cặp SS + FF giữa cùng hai task là hợp lệ và hay dùng (§6.4): cả hai cạnh cùng
  // hướng pred → succ nên không tạo vòng lặp. Không cần khử trùng, chỉ cần đừng coi
  // cạnh song song là vòng.
  const adj = new Map<string, string[]>();
  for (const d of input.dependencies) {
    if (!byUid.has(d.predUid) || !byUid.has(d.succUid)) continue;
    const list = adj.get(d.predUid);
    if (list === undefined) adj.set(d.predUid, [d.succUid]);
    else list.push(d.succUid);
  }
  for (const list of adj.values()) list.sort();

  const color = new Map<string, number>();
  // Duyệt theo uid đã sắp: vòng lặp nào được báo trước không được phụ thuộc thứ tự
  // dòng trả về từ DB (N2).
  const startOrder = [...byUid.keys()].sort();

  for (const start of startOrder) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;

    const path: string[] = [];
    // Stack tường minh thay vì đệ quy — 6.000 task có thể tạo chuỗi rất sâu.
    const stack: Array<{ uid: string; nextIndex: number }> = [{ uid: start, nextIndex: 0 }];
    color.set(start, GRAY);
    path.push(start);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      const neighbours = adj.get(frame.uid) ?? [];
      if (frame.nextIndex >= neighbours.length) {
        color.set(frame.uid, BLACK);
        stack.pop();
        path.pop();
        continue;
      }

      const next = neighbours[frame.nextIndex];
      frame.nextIndex++;
      if (next === undefined) continue;

      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // §8.1 đòi ĐƯỜNG ĐI đầy đủ, không chỉ báo "có cycle". Cắt path từ đỉnh xám.
        const from = path.indexOf(next);
        const cyclePath = [...path.slice(from), next];
        issues.push(
          critical('C01', `Dependency cycle: ${cyclePath.join(' -> ')}`, byUid.get(next), {
            path: cyclePath,
          }),
        );
        // Dừng hẳn: một vòng lặp đủ để chặn schedule, và liệt kê mọi vòng trên đồ thị
        // hỏng chỉ tạo nhiễu. PM sửa vòng này rồi chạy lại.
        return;
      }
      if (c === WHITE) {
        color.set(next, GRAY);
        path.push(next);
        stack.push({ uid: next, nextIndex: 0 });
      }
    }
  }
}

// ── C06 mức cấu trúc ────────────────────────────────────────────────────────

function checkMsoStructural(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  for (const t of input.tasks) {
    if (t.constraintType !== 'MSO') continue;

    if (t.constraintDate === null || t.constraintDate === '') {
      issues.push(critical('C06', `Task ${t.uid} has MSO constraint but no constraint_date.`, t));
      continue;
    }
    if (t.kind === 'summary') {
      // Ngày của summary là rollup từ con (§7.7); ép cứng ở đây là mâu thuẫn tự thân.
      issues.push(
        critical(
          'C06',
          `MSO constraint on summary task ${t.uid}; summary dates roll up from children.`,
          t,
        ),
      );
    }
  }

  for (const d of input.dependencies) {
    const pred = byUid.get(d.predUid);
    const succ = byUid.get(d.succUid);
    if (pred === undefined || succ === undefined) continue;
    if (pred.constraintType !== 'MSO' || succ.constraintType !== 'MSO') continue;
    if (pred.constraintDate === null || succ.constraintDate === null) continue;

    // Chỉ xét lag không âm: với lag âm, kết luận cần lịch làm việc và duration,
    // tức cần CPM — để P3. Thà bỏ sót còn hơn báo sai ở mức cấu trúc.
    if (d.lagDays < 0) continue;
    if (d.type !== 'FS' && d.type !== 'SS') continue;

    // FS: succ.start >= pred.finish + lag >= pred.start (duration >= 0, lag >= 0).
    // SS: succ.start >= pred.start + lag >= pred.start.
    // Hai ngày đều dạng YYYY-MM-DD nên so sánh chuỗi trùng với so sánh thời gian.
    if (succ.constraintDate < pred.constraintDate) {
      issues.push(
        critical(
          'C06',
          `MSO on ${succ.uid} (${succ.constraintDate}) is earlier than MSO on predecessor ${pred.uid} (${pred.constraintDate}) via ${d.type}.`,
          succ,
          {
            predUid: pred.uid,
            predDate: pred.constraintDate,
            succDate: succ.constraintDate,
            type: d.type,
            lagDays: d.lagDays,
          },
        ),
      );
    }
  }
}

// ── C11 — done phải có ngày thật ────────────────────────────────────────────

function checkProgress(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  for (const p of input.progress) {
    if (p.status !== 'done') continue;
    if (p.actualStart !== null && p.actualEnd !== null) continue;
    issues.push(
      critical(
        'C11',
        `Task ${p.taskUid} is done but actual_start or actual_end is missing.`,
        byUid.get(p.taskUid),
        {
          actualStart: p.actualStart,
          actualEnd: p.actualEnd,
        },
      ),
    );
  }
}

export type { DependencyRow, TaskRow };
