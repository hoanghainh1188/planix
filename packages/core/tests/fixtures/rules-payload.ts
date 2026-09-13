/**
 * Fixture cố ý VI PHẠM — mỗi rule §8.2/§8.3 nhìn thấy được lúc import một lần.
 *
 * Vì sao tách khỏi `wbs-20/500/6000`: ba fixture kia mô tả một dự án **lành**, và golden
 * của chúng là mốc để phát hiện engine đổi hành vi. Nhét vi phạm vào đó sẽ làm mọi diff
 * về sau lẫn giữa "engine đổi" và "fixture vốn đã bẩn". Tách ra thì mỗi file trả lời đúng
 * một câu hỏi.
 *
 * Vì sao cần: cho tới trước đây KHÔNG fixture nào kích hoạt `N01`–`N10` ngoài `N01` (một
 * cạnh SF tình cờ) và `N10`. `N08` chẳng hạn chưa từng xuất hiện trong bất kỳ golden nào —
 * `generate.ts` chỉ nối summary với summary. Một rule chỉ có unit test thì vẫn có thể hỏng
 * ở đường đi thật mà không ai biết.
 *
 * Nguyên tắc dựng: **không có Critical nào**. Critical làm import rollback (§9.3), và khi
 * đó không có gì để chụp lại. Nên mọi task `work` đều có `role`, `effort_md` > 0, cây đúng
 * một gốc, và không cạnh nào chạm vào nhánh sâu.
 */

export interface RuleFixtureTask {
  readonly tmp_id: string;
  readonly parent_tmp_id: string | null;
  readonly name: string;
  readonly kind: 'summary' | 'work' | 'milestone';
  readonly effort_md?: number;
  readonly role?: string;
  readonly phase?: string;
  readonly module?: string;
  readonly child_sequencing?: 'parallel' | 'sequential';
}

export interface RuleFixtureDependency {
  readonly pred: string;
  readonly succ: string;
  readonly type: 'FS' | 'SS' | 'FF' | 'SF';
  readonly lag_days: number;
}

/** Nhãn đầy đủ, dùng cho mọi task KHÔNG nhằm kích hoạt `N03`. */
const LABELS = { phase: 'P1', module: 'mod-1' } as const;

/**
 * Mỗi khối dưới đây nhắm đúng một rule. Đặt tên task theo rule nó kích hoạt để khi golden
 * đổi, diff tự nói ra chỗ nào đổi.
 */
export function buildRulesPayload(): {
  version: string;
  project_code: string;
  mode: string;
  tasks: RuleFixtureTask[];
  dependencies: RuleFixtureDependency[];
} {
  const tasks: RuleFixtureTask[] = [
    { tmp_id: 'root', parent_tmp_id: null, name: 'Rule coverage', kind: 'summary', ...LABELS },

    // ── N10: cụm `sequential` lại có thêm cạnh tường minh giữa hai con ──────
    {
      tmp_id: 'seq',
      parent_tmp_id: 'root',
      name: 'Sequential cluster',
      kind: 'summary',
      child_sequencing: 'sequential',
      ...LABELS,
    },
    {
      tmp_id: 'seq-a',
      parent_tmp_id: 'seq',
      name: 'Seq A',
      kind: 'work',
      effort_md: 2,
      role: 'Dev',
      ...LABELS,
    },
    {
      tmp_id: 'seq-b',
      parent_tmp_id: 'seq',
      name: 'Seq B',
      kind: 'work',
      effort_md: 2,
      role: 'Dev',
      ...LABELS,
    },

    // ── N01 (SF) và N02 (lag âm quá nửa duration) ───────────────────────────
    {
      tmp_id: 'style',
      parent_tmp_id: 'root',
      name: 'Link style',
      kind: 'summary',
      child_sequencing: 'parallel',
      ...LABELS,
    },
    {
      tmp_id: 'sf-pred',
      parent_tmp_id: 'style',
      name: 'SF pred',
      kind: 'work',
      effort_md: 4,
      role: 'Dev',
      ...LABELS,
    },
    {
      tmp_id: 'sf-succ',
      parent_tmp_id: 'style',
      name: 'SF succ',
      kind: 'work',
      effort_md: 2,
      role: 'Dev',
      ...LABELS,
    },
    {
      tmp_id: 'lead-succ',
      parent_tmp_id: 'style',
      name: 'Lead succ',
      kind: 'work',
      effort_md: 2,
      role: 'Dev',
      ...LABELS,
    },

    // ── N08: lá trỏ sang lá KHÁC cha ────────────────────────────────────────
    //
    // Hai nhánh riêng ở depth 2, lá ở depth 3 — bằng `dependency_max_level` mặc định nên
    // KHÔNG dính C12. Đây đúng là chỗ `N08` đứng một mình, và trước fixture này thì không
    // golden nào có nó.
    { tmp_id: 'left', parent_tmp_id: 'root', name: 'Left branch', kind: 'summary', ...LABELS },
    {
      tmp_id: 'left-leaf',
      parent_tmp_id: 'left',
      name: 'Left leaf',
      kind: 'work',
      effort_md: 1,
      role: 'Dev',
      ...LABELS,
    },
    { tmp_id: 'right', parent_tmp_id: 'root', name: 'Right branch', kind: 'summary', ...LABELS },
    {
      tmp_id: 'right-leaf',
      parent_tmp_id: 'right',
      name: 'Right leaf',
      kind: 'work',
      effort_md: 1,
      role: 'Dev',
      ...LABELS,
    },

    // ── J05: lá trên 10 MD ──────────────────────────────────────────────────
    {
      tmp_id: 'big',
      parent_tmp_id: 'root',
      name: 'Too big to plan',
      kind: 'work',
      effort_md: 25,
      role: 'Dev',
      ...LABELS,
    },

    // ── N03: lá thiếu nhãn. Một thiếu `module`, một thiếu cả hai ────────────
    {
      tmp_id: 'no-module',
      parent_tmp_id: 'root',
      name: 'Missing module',
      kind: 'work',
      effort_md: 1,
      role: 'Dev',
      phase: 'P1',
    },
    {
      tmp_id: 'no-labels',
      parent_tmp_id: 'root',
      name: 'Missing both',
      kind: 'work',
      effort_md: 1,
      role: 'Dev',
    },

    // ── N05: hai anh em trùng tên ───────────────────────────────────────────
    {
      tmp_id: 'twin',
      parent_tmp_id: 'root',
      name: 'Same name',
      kind: 'work',
      effort_md: 1,
      role: 'QA',
      ...LABELS,
    },
    {
      tmp_id: 'twin-2',
      parent_tmp_id: 'root',
      name: 'Same name',
      kind: 'work',
      effort_md: 1,
      role: 'QA',
      ...LABELS,
    },
  ];

  // ── N04: nhánh sâu quá 6 cấp ──────────────────────────────────────────────
  //
  // Không cạnh nào chạm vào nhánh này: một dependency ở depth > 3 sẽ là C12 (Critical) và
  // làm cả lần import rollback, tức mất luôn golden.
  let parent = 'root';
  for (let depth = 2; depth <= 8; depth++) {
    const id = `deep-${String(depth)}`;
    tasks.push(
      depth === 8
        ? {
            tmp_id: id,
            parent_tmp_id: parent,
            name: `Deep ${String(depth)}`,
            kind: 'work',
            effort_md: 1,
            role: 'Dev',
            ...LABELS,
          }
        : {
            tmp_id: id,
            parent_tmp_id: parent,
            name: `Deep ${String(depth)}`,
            kind: 'summary',
            ...LABELS,
          },
    );
    parent = id;
  }

  const dependencies: RuleFixtureDependency[] = [
    // N10 — cụm đã `sequential`, cạnh này là thừa.
    { pred: 'seq-a', succ: 'seq-b', type: 'FS', lag_days: 0 },
    // N01 — SF hiếm khi đúng.
    { pred: 'sf-pred', succ: 'sf-succ', type: 'SF', lag_days: 0 },
    // N02 — `sf-pred` là 4 MD → duration 4 ngày; lead 3 ngày ăn quá nửa.
    { pred: 'sf-pred', succ: 'lead-succ', type: 'FS', lag_days: -3 },
    // N08 — lá sang lá khác cha.
    { pred: 'left-leaf', succ: 'right-leaf', type: 'FS', lag_days: 0 },
  ];

  return { version: '1.0', project_code: 'UTG', mode: 'merge', tasks, dependencies };
}
