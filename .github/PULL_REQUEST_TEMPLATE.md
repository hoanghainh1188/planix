<!-- Xem quy trình đầy đủ: docs/TEAM-WORKFLOW.md -->

## Feature
Closes #<!-- số issue = feature ID -->

## Tóm tắt
<!-- Feature này làm gì, dựa trên tài liệu design nào -->

## Traceability (đã commit vào branch)
- [ ] `docs/intake/<NNN>-<slug>.md` — output của `design-intake` (đặt theo số issue)
- [ ] `docs/04-decisions/*` — mọi câu trả lời `/speckit-clarify` (nếu có ambiguity)
- [ ] `specs/<feature>/` — spec.md / plan.md / tasks.md do Spec Kit sinh

## Chất lượng
- [ ] Đã chạy subagent `code-reviewer`, xử lý hết mục **Blocking**
- [ ] Đã chạy `glossary-steward` (term lệch đã sửa) và `security-reviewer` (nếu feature đụng data/auth/API)
- [ ] Test gate xanh: `npm run lint` / `test` / `build` (hoặc tương đương của dự án)
- [ ] Coverage đạt ngưỡng constitution (Article W — mặc định ≥ 80% business logic)
- [ ] CI `template-smoke-test` (và CI dự án) xanh

## File dùng chung (gác cổng)
- [ ] **THÊM** term mới vào `docs/00-glossary.md` (append) — OK để trong PR này; steward (code-owner) review phần glossary
- [ ] PR này **không SỬA/đổi tên** term đã có, và **không đổi** `.specify/memory/constitution.md`
      → *nếu có, đã tách thành **PR riêng** được **code-owner** duyệt (xem `.github/CODEOWNERS`)*
- [ ] Đã rebase lên `main` mới nhất; nếu glossary/constitution vừa đổi → đã chạy lại `/speckit-analyze`

## Branch
- [ ] Tên branch dạng `NNN-<slug>` với `NNN` = số issue (zero-pad ≥ 3 chữ số)
