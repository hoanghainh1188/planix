# spec-driven-jp — Template dự án tích hợp Spec Kit + đọc tài liệu thiết kế tiếng Nhật

Template cho các dự án greenfield dùng Claude Code, đặc biệt phù hợp với bối cảnh **BrSE làm việc với khách hàng Nhật**: có tài liệu basic design (基本設計), detail design (詳細設計), và Figma làm nguồn thiết kế đầu vào.

Tích hợp:
- **[GitHub Spec Kit](https://github.com/github/spec-kit)** làm khung xương spec-driven (constitution + specify → clarify → plan → tasks → analyze → implement)
- **4 subagent chuyên biệt** bù đắp phần Spec Kit không có: `design-intake` (đọc tài liệu Nhật + Figma qua MCP), `code-reviewer` (đối chiếu code với 4 nguồn sau khi implement), `security-reviewer` (pass bảo mật OWASP + secret + PII), và `glossary-steward` (gác nhất quán thuật ngữ Nhật-Việt-Anh)
- **Glossary Nhật-Việt-Anh** làm nguồn thuật ngữ chung
- **Permission gate** cấu hình sẵn theo nguyên tắc deny → ask → allow

## Có 2 cách dùng template này

### Cách 1: Dùng như GitHub template repo (khuyến nghị cho hầu hết trường hợp)

1. Fork/clone repo này lên GitHub tài khoản của bạn.
2. Vào Settings → chọn "Template repository" để biến nó thành template.
3. Với mỗi dự án mới, bấm "Use this template" → "Create a new repository".
4. `git clone` repo mới về máy, chạy `bash bootstrap.sh` để hoàn tất setup (chạy `specify init` để tạo `.specify/` và các skill Spec Kit `/speckit-*` trong `.claude/skills/`).
5. Chạy `/speckit-constitution` trong Claude Code — sau đó xem `docs/CONSTITUTION_APPEND.md` để bổ sung các article cho bối cảnh Nhật.

### Cách 2: Cài đặt như Claude Code plugin

Cách này phù hợp khi bạn muốn dùng bộ agent + command cho **nhiều dự án đã có sẵn**, không phải chỉ dự án mới.

```bash
# Trong Claude Code
/plugin marketplace add hoanghainh1188/spec-driven-jp
/plugin install spec-driven-jp@hoanghainh1188
```

Plugin sẽ cài 4 agent (`design-intake`, `code-reviewer`, `security-reviewer`, `glossary-steward`) và command `/design-to-code` vào user scope (`~/.claude/`). Xem chi tiết ở `plugin/README.md`.

**Lưu ý**: cách plugin không tự tạo cấu trúc `docs/` hay chạy `specify init` — bạn cần làm những bước đó thủ công nếu dự án chưa có sẵn. Cách 1 (template repo) tự động hóa cả 2.

## Cấu trúc dự án được sinh ra

```
<project>/
├── CLAUDE.md                       Quy ước dự án, agent đọc đầu tiên
├── bootstrap.sh                    Chạy specify init + bổ sung agent/command
├── .claude/
│   ├── settings.json              Permission deny/ask/allow đã cấu hình sẵn
│   ├── agents/
│   │   ├── design-intake.md       Đọc docs Nhật + Figma, sinh input cho /speckit-specify
│   │   ├── code-reviewer.md       Review code sau /speckit-implement
│   │   ├── security-reviewer.md   Pass bảo mật OWASP + secret + PII sau code-reviewer
│   │   └── glossary-steward.md    Gác nhất quán thuật ngữ Nhật-Việt-Anh (pipeline + standalone)
│   ├── hooks/
│   │   └── format.sh              Format-on-save hook (điền formatter theo stack)
│   └── commands/
│       └── design-to-code.md      Điều phối toàn bộ pipeline hybrid
├── docs/
│   ├── 00-glossary.md              Thuật ngữ 日本語 / VI / EN — nguồn duy nhất
│   ├── 01-basic-design/            基本設計 gốc từ khách hàng (không sửa tay)
│   ├── 02-detail-design/           詳細設計 gốc
│   ├── 03-ui/                      Link Figma + snapshot
│   ├── 04-decisions/               Câu trả lời cho /speckit-clarify (INDEX.md = mục lục tra nhanh)
│   ├── 05-lessons.md               Bài học / gotcha kỹ thuật gặp khi code (append 1 dòng)
│   ├── intake/                     Output của design-intake
│   └── CONSTITUTION_APPEND.md      Gợi ý các article cho bối cảnh Nhật
├── src/
├── tests/
└── plugin/                         Metadata để dùng như Claude Code plugin
    ├── plugin.json
    └── README.md
```

Sau khi chạy `bootstrap.sh`, thêm:
```
├── .specify/
│   ├── memory/constitution.md      Do /speckit-constitution sinh
│   ├── templates/                  Template Spec Kit
│   └── scripts/                    Helper script Spec Kit
├── .claude/skills/speckit-*/       Skills Spec Kit (constitution, specify, clarify, plan, tasks, analyze, implement, …)
└── specs/                          Do Spec Kit sinh mỗi feature 1 thư mục
```

## Feature mẫu để tham khảo (xoá được)

Template kèm 1 feature mẫu tí hon — **予約承認 (duyệt đặt chỗ)** — để bạn thấy **cả chuỗi traceability
lẫn hình dạng code** trước khi tự chạy (đường dẫn dạng code để xoá xong không để lại link chết):
- `docs/intake/000-example-reservation.md` — output mẫu của `design-intake`
- `docs/04-decisions/2026-01-01-approval-vs-confirm.md` — quyết định clarify mẫu
- `specs/000-example-reservation/` — `spec.md` + `plan.md` + `tasks.md` mẫu (bình thường do Spec Kit sinh)
- `src/features/example-reservation/` — **code + test mẫu** (hàm thuần + unit test cạnh nhau), minh hoạ
  layout `src/features/<slug>/`, dùng thuật ngữ glossary trong tên, và TDD theo Article W

**Xoá trước khi làm dự án thật:**
```bash
rm -rf specs/000-example-reservation \
       src/features/example-reservation \
       docs/intake/000-example-reservation.md \
       docs/04-decisions/2026-01-01-approval-vs-confirm.md
# Xóa dòng mẫu trong INDEX (giữ header + bảng trống / comment ví dụ):
python3 -c "
from pathlib import Path
p = Path('docs/04-decisions/INDEX.md')
lines = [l for l in p.read_text().splitlines() if '000-example-reservation' not in l]
p.write_text('\n'.join(lines) + '\n')
"
```

## Workflow cho 1 feature

### Bước bạn thao tác
1. **Tạo GitHub issue** cho feature (số issue = ID feature), rồi tạo branch `NNN-<slug>` với
   `NNN` = số issue zero-pad ≥ 3 chữ số (VD issue #42 → `042-user-reservation`).
2. **Đặt tài liệu nguồn** (không sửa nội dung gốc), mỗi feature 1 thư mục — **`<slug>` = phần sau
   `NNN-` trên branch** (VD `042-user-reservation` → `user-reservation`):
   - `docs/01-basic-design/<slug>/` — 基本設計 (user story / behavior)
   - `docs/02-detail-design/<slug>/` — 詳細設計 (bảng field + validation, business rule / edge / error)
   - `docs/03-ui/<slug>/figma-links.md` — link Figma + snapshot
   > ⚠️ `Read` không parse `.docx/.xlsx/.pdf` nhị phân — kèm **bản export text/markdown** cạnh file gốc
   > (hoặc cài Skill `docx/xlsx/pdf`). Cấu trúc + checklist nội dung đầy đủ: xem `README.md` trong từng
   > thư mục `docs/01-03`.
3. **Gõ `/design-to-code`** trong Claude Code, cung cấp đường dẫn tài liệu + link Figma khi được hỏi.
4. Ở mỗi bước **[HANDOFF]**, copy lệnh `/speckit-*` mà Claude in ra, tự dán chạy, rồi báo lại.
5. Duyệt ở mỗi **[DỪNG]** (review intake, analyze, test gate, deploy).

> **Nhiều người cùng làm 1 dự án?** Xem [`docs/TEAM-WORKFLOW.md`](docs/TEAM-WORKFLOW.md) — quy ước
> đánh số theo issue, branch/PR model, gác cổng glossary + constitution, và cách tránh conflict/lệch ngữ cảnh.

### Sơ đồ workflow

```mermaid
flowchart TD
    A["📁 Đặt tài liệu vào docs/01-03/"]:::user --> B["⌨️ Gõ /design-to-code"]:::user
    B --> B2["Nạp memory: constitution + glossary<br/>+ decisions INDEX + lessons"]:::auto
    B2 --> C["Tạo git branch NNN-feature"]:::auto
    C --> D["design-intake đọc tài liệu → docs/intake/"]:::auto
    D --> E{"DỪNG — review intake<br/>prompt + ambiguities"}:::stop
    E --> F["/speckit-specify — prompt từ intake"]:::handoff
    F --> G{"Có ambiguities?"}:::stop
    G -- Có --> H["/speckit-clarify → docs/04-decisions/"]:::handoff
    G -- Không --> I["/speckit-plan"]:::handoff
    H --> I
    I --> J["/speckit-tasks"]:::handoff
    J --> K{"DỪNG — /speckit-analyze<br/>còn cảnh báo?"}:::stop
    K -- Có, sửa spec/plan/tasks --> F
    K -- Không --> L["/speckit-implement → sinh code"]:::handoff
    L --> M{"code-reviewer<br/>còn Blocking?"}:::auto
    M -- Có --> L
    M -- Không --> Q["glossary-steward<br/>đối chiếu term vs glossary"]:::auto
    Q --> R{"security-reviewer<br/>(nếu đụng data/auth)<br/>còn Blocking?"}:::auto
    R -- Có --> L
    R -- Không --> N{"DỪNG — test gate<br/>lint/test/build xanh<br/>+ coverage ≥ ngưỡng?"}:::stop
    N -- Đỏ --> L
    N -- Xanh --> O["DỪNG — deploy theo CLAUDE.md"]:::stop
    O --> P["✅ Commit intake + decisions + specs"]:::user

    classDef user fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef auto fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef handoff fill:#fef9c3,stroke:#a16207,color:#713f12
    classDef stop fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
```

**Chú thích màu:**
🟦 Bạn thao tác · 🟩 `[TỰ CHẠY]` Claude tự làm (git + subagent) · 🟨 `[HANDOFF]` bạn tự dán lệnh `/speckit-*` · 🟥 `[DỪNG]` checkpoint chờ duyệt

### `/design-to-code` là runbook điều phối
Nó **không tự chạy được** các slash command `/speckit-*` (Claude Code không cho command gọi
command). Vì vậy có 2 loại bước:

| Loại | Ai làm | Gồm |
|------|--------|-----|
| **[TỰ CHẠY]** | Claude tự làm | tạo git branch, gọi subagent `design-intake`, `code-reviewer`, `glossary-steward`, `security-reviewer` |
| **[HANDOFF]** | **Bạn tự dán lệnh** | Claude in `/speckit-x …`, bạn chạy rồi báo xong |

Trình tự đầy đủ:

1. `[TỰ CHẠY]` **nạp memory** — đọc + tóm tắt `constitution` + `docs/00-glossary.md` + `docs/04-decisions/INDEX.md` + `docs/05-lessons.md` + `CLAUDE.md` (recall bắt buộc, chống lệch ngữ cảnh)
2. `[TỰ CHẠY]` tạo branch `NNN-<feature-slug>` (Spec Kit dùng tên branch để phát hiện feature)
3. `[TỰ CHẠY]` `design-intake` đọc tài liệu → sinh `docs/intake/<NNN>-<slug>.md` (khớp tên branch)
4. **[DỪNG]** bạn review file intake (prompt + ambiguities)
5. `[HANDOFF]` `/speckit-specify <prompt từ intake>`
6. `[HANDOFF]` `/speckit-clarify` (nếu có mâu thuẫn) → câu trả lời ghi vào `docs/04-decisions/` + append `INDEX.md`
7. `[HANDOFF]` `/speckit-plan`
8. `[HANDOFF]` `/speckit-tasks`
9. **[DỪNG]** `/speckit-analyze` → sửa spec/plan/tasks nếu có cảnh báo trước khi implement
10. `[HANDOFF]` `/speckit-implement` → sinh code thật
11. `[TỰ CHẠY]` `code-reviewer` đối chiếu code với constitution + spec + plan + tasks (+ `docs/05-lessons.md`) → xử lý mọi **Blocking**
12. `[TỰ CHẠY]` `glossary-steward` đối chiếu term code/spec vs `docs/00-glossary.md` → sửa term lệch (term **mới** → append thẳng trong branch feature; chỉ **SỬA/đổi tên** term đã có mới cần PR glossary riêng)
13. `[TỰ CHẠY]` `security-reviewer` soi OWASP + secret + PII (chỉ khi feature đụng data/auth/API; nếu không thì tự SKIP) → xử lý mọi **Blocking**
14. **[DỪNG] Test gate** — format tự chạy qua hook `.claude/hooks/format.sh`; verify `npm run lint/test/build` phải xanh **và coverage đạt ngưỡng constitution** (Article W — mặc định ≥ 80% business logic); gặp gotcha → append `docs/05-lessons.md`
15. **[DỪNG] Deploy** — theo phương thức khai trong mục `## Deploy` của `CLAUDE.md`

Cuối cùng, commit `docs/intake/`, `docs/04-decisions/`, `docs/05-lessons.md`, `specs/<feature>/` làm bằng chứng traceability.

## Làm việc nhóm (nhiều người / 1 dự án)

Để tránh **git conflict** và **lệch ngữ cảnh** khi nhiều người cùng làm:

- **Feature ID = số issue GitHub** → branch `NNN-<slug>` (zero-pad ≥ 3 chữ số, VD `042-user-reservation`).
  Số issue duy nhất toàn cục → không trùng khi chạy song song.
- **1 người sở hữu 1 feature** end-to-end; branch ngắn hạn; PR `Closes #<issue>`; merge khi CI xanh + review pass.
- **Cô lập code theo feature** → `src/features/<slug>/`; chỉ chạm vùng dùng chung (`src/shared/`, config)
  khi thật cần, tách commit nhỏ để giảm merge conflict.
- **Glossary + constitution** là file dùng chung: **THÊM** term mới → append ngay trong branch feature
  (steward review khi mở PR); **SỬA** term đã có / đổi constitution → **PR riêng được steward duyệt**.
- **Rebase `main` thường xuyên**; khi constitution/glossary đổi → chạy lại `/speckit-analyze` để bắt drift.

**2 việc setup thủ công (load-bearing — chưa làm thì gác cổng CODEOWNERS âm thầm vô hiệu):**
1. Sửa `.github/CODEOWNERS`: thay `@your-lead-handle` bằng GitHub handle thật của steward.
2. Bật **branch protection** cho `main`: *Require PR review* + *Require review from Code Owners*
   + *Require status checks* (`template-smoke-test`) + *Require branches up to date*.

📖 Chi tiết đầy đủ (vòng đời feature, bảng điểm nóng conflict, xử lý cập nhật design giữa chừng):
[`docs/TEAM-WORKFLOW.md`](docs/TEAM-WORKFLOW.md).

> 🔒 **Trước khi lên dự án thật**, chạy qua [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md) —
> checklist biến các gác cổng "tự khai" (coverage, review, secret) thành gate ép bằng CI/branch protection.

## Yêu cầu môi trường

- Claude Code (bản mới nhất, hỗ trợ subagent + command + settings.json)
- `uv` hoặc `pipx` để cài Spec Kit CLI (`uvx --from git+https://github.com/github/spec-kit.git specify init ...`)
- `git`
- **Figma MCP server** — để `design-intake` đọc Figma tự động. Agent grant sẵn **cả 2 prefix phổ biến**:
  `mcp__figma__*` (Figma Dev Mode local) và `mcp__claude_ai_Figma__*` (connector Claude.ai) — kết nối
  kiểu nào cũng chạy, không cần sửa. Kiểm bằng `claude mcp list`; chỉ khi server tên khác cả 2 mới cần
  thêm prefix vào `tools:` trong `.claude/agents/design-intake.md`. Không có Figma MCP thì `design-intake`
  vẫn chạy — đọc link/snapshot trong `docs/03-ui/`.
- **Skill đọc tài liệu** (`docx`, `xlsx`, `pdf`) — cần để `design-intake` trích nội dung file Office/PDF
  nhị phân (tool `Read` thuần không parse được). Nếu skill chưa cài, chuẩn bị sẵn bản export
  text/markdown của tài liệu đặt cạnh file gốc.

## Giấy phép

MIT — dùng thoải mái, sửa thoải mái. Nếu bạn cải tiến template, PR về là rất được hoan nghênh.
