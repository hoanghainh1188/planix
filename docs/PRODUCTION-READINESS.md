# Production readiness — gác cổng còn phải TỰ BẬT

Template lo phần *quy trình* (pipeline, traceability, review). Nhưng nhiều guardrail chỉ **được khai
báo** (checkbox PR, quy ước) chứ chưa **được ép** — vì template không biết trước tech stack của bạn.
Danh sách dưới biến chúng thành gate thật. Làm **một lần khi lên dự án thật**, trước khi có người thứ 2 join.

> Vì sao tách ra đây: `check-template.py` + `template-smoke-test` chỉ kiểm *tính nhất quán của chính
> template*, KHÔNG đụng tới code dự án bạn sinh ra. Enforcement code là việc của CI dự án — bên dưới.

## 1. Bật gác cổng con người (load-bearing) — bắt buộc

- [ ] **`.github/CODEOWNERS`**: thay `@your-lead-handle` bằng handle steward thật.
- [ ] **Branch protection cho `main`**: *Require PR* + *Require review from Code Owners* +
      *Require status checks* + *Require branches up to date*. Chi tiết: `docs/TEAM-WORKFLOW.md` mục 9.

> Chưa bật thì CODEOWNERS chỉ là gợi ý — ai cũng merge thẳng, gác cổng glossary/constitution vô hiệu.

## 2. Ép chất lượng bằng CI dự án (không chỉ checkbox PR)

PR template có ô "coverage ≥ 80%" và "đã chạy reviewer" — đó là **tự khai**. Biến thành gate:

- [ ] Thêm workflow CI của dự án (tách khỏi `template-smoke-test`) chạy: `lint` → `test --coverage` →
      `build` theo stack thật. **Fail CI nếu coverage < ngưỡng Article W (mặc định 80%)** — đừng để
      con người tự đánh dấu đạt.
      - JS/TS: `vitest run --coverage` / `jest --coverage --coverageThreshold`
      - Go: `go test -cover ./...` (+ kiểm ngưỡng), Python: `pytest --cov --cov-fail-under=80`,
        Java: JaCoCo `check` rule.
- [ ] Đưa CI này vào danh sách *Require status checks* của branch protection (mục 1).

## 3. Quét secret ở tầng CI (deny của agent KHÔNG đủ)

`settings.json` deny `Read(.env)`, `**/*credentials*`… chỉ chặn **agent đọc** — KHÔNG chặn một người
*commit* nhầm secret. Thêm một lớp CI:

- [ ] Bật secret-scanning: GitHub *Secret scanning* + *Push protection* (Settings → Code security),
      hoặc action như `gitleaks`/`trufflehog` chạy trên mỗi PR.

## 4. security-reviewer thành gate cho feature nhạy cảm (tuỳ dự án)

`security-reviewer` chạy trong `/design-to-code` nhưng là subagent do người vận hành gọi — không tự
chặn merge. Nếu dự án xử lý dữ liệu người dùng/thanh toán:

- [ ] Quy ước: PR chạm auth/PII/API/DB **phải** đính báo cáo `security-reviewer` (không còn Blocking)
      mới được duyệt — steward kiểm ở review, hoặc thêm label + required check.

---

Xong 4 mục trên, các guardrail vốn "tự khai" trở thành **được ép bằng máy**. Trước đó, hãy coi chúng
là *quy ước dựa trên kỷ luật* — xem cột "enforcement" trong ma trận phòng thủ ở `docs/TEAM-WORKFLOW.md` mục 5.
