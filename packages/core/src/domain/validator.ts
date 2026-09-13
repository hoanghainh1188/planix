/**
 * Rule Validator — SPEC.md §8.
 *
 * P1 cài đặt đủ mức Critical `C01`–`C12` (§8.1). Mức Major/Minor phần lớn thuộc các phase
 * sau, khi đã có lịch để đối chiếu; `N01` và `N08` không cần lịch nên nằm ở đây.
 *
 * Các rule §8.2/§8.3 còn thiếu được liệt kê ở
 * `docs/decisions/2026-09-13-validator-rules-con-thieu.md`.
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
  checkDependencyStyle(input, byUid, issues);
  checkTaskSize(input, issues);
  checkDepthLimit(input, issues);
  checkDuplicateNames(input, issues);
  checkLeafLabels(input, issues);
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

function major(
  code: string,
  message: string,
  task?: TaskRow,
  detail?: Record<string, unknown>,
): ValidationIssue {
  const issue: ValidationIssue = { severity: 'Major', code, message };
  return {
    ...issue,
    ...(task === undefined ? {} : { taskUid: task.uid, wbsCode: task.wbsCode }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function minor(
  code: string,
  message: string,
  task?: TaskRow,
  detail?: Record<string, unknown>,
): ValidationIssue {
  const issue: ValidationIssue = { severity: 'Minor', code, message };
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

// ── J05, N04, N05 — hình dáng cây (§8.2, §8.3) ──────────────────────────────

/** uid của mọi task CÓ con. Dùng chung cho các rule phân biệt lá với summary. */
function parentsOf(tasks: readonly TaskRow[]): ReadonlySet<string> {
  const parents = new Set<string>();
  for (const t of tasks) {
    if (t.parentUid !== null) parents.add(t.parentUid);
  }
  return parents;
}

/**
 * `J05` — task lá lớn hơn 10 MD, tức chưa phân rã.
 *
 * Chỉ xét LÁ. Một summary 40 MD không phải vấn đề — nó đã được phân rã, và 40 MD là tổng
 * của các con. Bắt cả summary sẽ báo động trên đúng thứ mà rule muốn thấy.
 *
 * "> 10" hiểu theo nghĩa đen: đúng 10 MD thì thôi.
 */
function checkTaskSize(input: ValidationInput, issues: ValidationIssue[]): void {
  const parents = parentsOf(input.tasks);
  for (const t of input.tasks) {
    if (parents.has(t.uid)) continue;
    if (t.effortMd === null || t.effortMd <= 10) continue;
    issues.push(
      major('J05', `Task ${t.wbsCode} is ${String(t.effortMd)} MD; break it down.`, t, {
        effortMd: t.effortMd,
      }),
    );
  }
}

/** `N04` — nhánh sâu quá 6 cấp. `depth` do renumber sinh, nên luôn đúng với cây hiện tại. */
function checkDepthLimit(input: ValidationInput, issues: ValidationIssue[]): void {
  for (const t of input.tasks) {
    if (t.depth <= MAX_WBS_DEPTH) continue;
    issues.push(
      minor('N04', `Task ${t.wbsCode} is at depth ${String(t.depth)}; the limit is 6.`, t, {
        depth: t.depth,
      }),
    );
  }
}

/**
 * `N05` — hai anh em trùng tên.
 *
 * Chỉ xét TRONG cùng một cha: "Thiết kế" nằm dưới mỗi module là chuyện bình thường và
 * đúng đắn; hai dòng "Thiết kế" dưới CÙNG một module mới là dấu hiệu dán nhầm.
 *
 * Báo một lần cho mỗi bản trùng, không báo cả cặp: hai dòng cùng tên là MỘT vấn đề, và
 * báo cả hai thì PM sửa một bên rồi vẫn thấy cảnh báo còn lại, tưởng mình chưa xong.
 * Duyệt theo uid đã sắp nên "bản đầu tiên" không phụ thuộc thứ tự dòng từ DB (N2).
 */
function checkDuplicateNames(input: ValidationInput, issues: ValidationIssue[]): void {
  const seen = new Map<string, TaskRow>();
  const ordered = [...input.tasks].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

  for (const t of ordered) {
    // Gốc có `parentUid` null; gộp chúng vào cùng một nhóm bằng một khoá không thể trùng
    // với uid thật.
    const key = `${t.parentUid ?? '\u0000root'}\u0000${t.name}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, t);
      continue;
    }
    issues.push(
      minor('N05', `Task ${t.wbsCode} has the same name as ${first.wbsCode}: "${t.name}".`, t, {
        otherUid: first.uid,
      }),
    );
  }
}

/**
 * `N03` — task lá thiếu `phase` hoặc `module`.
 *
 * Hai nhãn này là thứ báo cáo §11 gộp theo, nên lá không có chúng sẽ rơi ra ngoài mọi
 * bảng tổng hợp — im lặng, không ai thấy thiếu.
 *
 * Chuỗi rỗng tính là thiếu: `phase: ""` không phải một phase, và một importer cẩu thả
 * sinh ra chuỗi rỗng dễ hơn sinh ra `null`.
 *
 * Thiếu cả hai vẫn chỉ MỘT dòng — đó là một task cần sửa, không phải hai vấn đề. Nhưng
 * thông điệp phải nói thiếu cái gì, nếu không PM mở task ra rồi mới đoán được.
 */
function checkLeafLabels(input: ValidationInput, issues: ValidationIssue[]): void {
  const parents = parentsOf(input.tasks);
  const blank = (v: string | null | undefined): boolean =>
    v === null || v === undefined || v === '';

  for (const t of input.tasks) {
    if (parents.has(t.uid)) continue;
    const missing: string[] = [];
    if (blank(t.phase)) missing.push('phase');
    if (blank(t.module)) missing.push('module');
    if (missing.length === 0) continue;

    issues.push(
      minor('N03', `Leaf task ${t.wbsCode} has no ${missing.join(' and ')}.`, t, { missing }),
    );
  }
}

// ── N01, N08 — cách khai báo ràng buộc (§6.1, §6.3) ─────────────────────────

/**
 * `N01` — cạnh SF, và `N08` — cạnh lá sang lá khác cha.
 *
 * Cả hai đều mức Minor: §8.3 là "ghi nhận", không phải "cấm". Engine vẫn xếp lịch bình
 * thường; đây là chỗ để PM nhìn lại xem có phải mình gõ nhầm không.
 *
 * Vì sao `N01` tồn tại: §6.1 — "SF hiếm dùng trong phần mềm, hay bị AI sinh nhầm. Engine
 * chấp nhận nhưng LUÔN ghi N01". Với một tool mà đầu vào có thể do AI sinh ra (§12), đây
 * là tấm lưới duy nhất bắt được một quan hệ viết ngược.
 *
 * Vì sao `N08` tồn tại: §6.2 xếp lịch THEO CỤM, và cạnh giữa hai lá khác cha vượt ra
 * ngoài cụm. Cùng cha thì không — đó chính là "Cách 2" mà §6.3 cho phép.
 *
 * Chồng lấn với `C12` là có thật và đã biết: một cạnh lá-khác-cha nằm sâu hơn
 * `dependency_max_level` dính cả hai. Hai rule nói hai điều khác nhau về cùng một cạnh
 * ("khai báo sai cấp" và "vượt ra ngoài cụm"), nên không rule nào được nuốt rule kia.
 * Xem docs/decisions/2026-09-13-c12-vs-sibling-edges.md.
 */
function checkDependencyStyle(
  input: ValidationInput,
  byUid: ReadonlyMap<string, TaskRow>,
  issues: ValidationIssue[],
): void {
  // "Lá" hiểu theo CẤU TRÚC — không có con — chứ không theo `kind`. Một summary rỗng
  // không có cụm nào để mà xếp theo cụm, nên với §6.2 nó cư xử y như một lá.
  const hasChildren = parentsOf(input.tasks);
  const isLeaf = (uid: string): boolean => !hasChildren.has(uid);

  for (const d of input.dependencies) {
    const pred = byUid.get(d.predUid);
    const succ = byUid.get(d.succUid);
    // Đầu hỏng đã có C03; gắn issue vào một uid không tồn tại chỉ tạo thêm nhiễu.
    if (pred === undefined || succ === undefined) continue;

    if (d.type === 'SF') {
      // Gắn vào task PHÍA SAU: nó là task bị ràng buộc, và là dòng PM sẽ mở ra xem.
      issues.push(
        minor('N01', 'SF is rarely correct. Did you mean FS?', succ, {
          predUid: pred.uid,
          succUid: succ.uid,
        }),
      );
    }

    if (isLeaf(pred.uid) && isLeaf(succ.uid) && pred.parentUid !== succ.parentUid) {
      issues.push(
        minor(
          'N08',
          `Leaf task ${succ.wbsCode} depends on leaf task ${pred.wbsCode} under a different parent.`,
          succ,
          { predUid: pred.uid, succUid: succ.uid },
        ),
      );
    }

    // `N02` — lag âm (lead) ăn quá nửa duration của predecessor, tức hai task chồng lấn
    // nhiều tới mức gần như chạy song song. §6.1 cho phép lag âm; đây chỉ là lời nhắc.
    //
    // Duration lấy từ effort theo §7.2 — KHÔNG từ `schedule`, vì rule này phải chạy được
    // ngay lúc import, trước khi có lịch. Predecessor là summary thì bỏ qua: effort của nó
    // là tổng của con, còn khoảng thời gian nó trải ra thì chỉ biết sau khi xếp lịch.
    if (d.lagDays < 0 && !hasChildren.has(pred.uid) && pred.effortMd !== null) {
      const duration = nominalDuration(pred.effortMd);
      if (duration > 0 && Math.abs(d.lagDays) > duration / 2) {
        issues.push(
          minor(
            'N02',
            `Lead of ${String(Math.abs(d.lagDays))} days is over half the ${String(duration)}-day duration of ${pred.wbsCode}.`,
            succ,
            { predUid: pred.uid, succUid: succ.uid, lagDays: d.lagDays, duration },
          ),
        );
      }
    }

    // `N10` — cụm `sequential` đã tự sinh cạnh FS ảo giữa các con liên tiếp (§6.3 Cách 1),
    // nên một cạnh tường minh giữa hai con của nó thường là thừa. "Thường", không phải
    // "luôn": cạnh tường minh CỘNG THÊM vào cạnh ảo, và một cạnh SS hay một lag khác 0 vẫn
    // có thể là chủ ý. Vì vậy đây là Minor — nhắc kiểm lại, không phải lỗi.
    if (
      pred.parentUid !== null &&
      pred.parentUid === succ.parentUid &&
      byUid.get(pred.parentUid)?.childSequencing === 'sequential'
    ) {
      const cluster = byUid.get(pred.parentUid);
      issues.push(
        minor(
          'N10',
          `Cluster ${cluster?.wbsCode ?? pred.parentUid} is sequential, so the link from ${pred.wbsCode} may be redundant.`,
          succ,
          { predUid: pred.uid, succUid: succ.uid, clusterUid: pred.parentUid },
        ),
      );
    }
  }
}

/** §7.2 — duration danh nghĩa, làm tròn LÊN bội số 0,5. Cùng công thức với scheduler. */
function nominalDuration(effortMd: number): number {
  return Math.ceil(effortMd * 2) / 2;
}

// ── C01 — vòng lặp phụ thuộc, DFS ba màu (§6.4) ─────────────────────────────

/** §8.3 `N04`. */
const MAX_WBS_DEPTH = 6;

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
