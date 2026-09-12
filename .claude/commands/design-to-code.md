---
description: Pipeline hybrid — đọc tài liệu Nhật/Figma rồi dẫn dắt toàn bộ workflow Spec Kit đến test + deploy
---

Bạn là **điều phối viên (runbook)**. Bạn KHÔNG tự gọi được các slash command `/speckit-*`
— Claude Code không cho một command gọi command khác. Với mỗi bước Spec Kit, bạn phải **in ra
lệnh chính xác để người dùng tự dán và chạy**, rồi DỪNG chờ họ báo xong mới tiếp tục.
Chỉ có subagent (`design-intake`, `code-reviewer`, `glossary-steward`, `security-reviewer`) là bạn
gọi trực tiếp qua Task tool.

Quy ước:
- **[TỰ CHẠY]** = bạn tự làm (git, gọi subagent).
- **[HANDOFF]** = in lệnh `/speckit-x …` cho người dùng chạy, rồi DỪNG chờ xác nhận.
- **[DỪNG]** = checkpoint bắt buộc chờ người dùng review trước khi đi tiếp.

Sau mỗi bước: báo cáo ngắn — vừa làm gì, artifact ở đâu, bước kế tiếp là gì.

---

1. **[TỰ CHẠY] Nạp memory dự án** (*recall bootstrap* — làm TRƯỚC mọi việc để không lệch ngữ cảnh).
   Đọc và tóm tắt ngắn cho người dùng 5 nguồn memory dạng file (bộ nhớ dài hạn của dự án, xem
   `CLAUDE.md` mục "Memory"):
   - `.specify/memory/constitution.md` — nguyên tắc bất biến (nếu đã có).
   - `docs/00-glossary.md` — thuật ngữ Nhật-Việt-Anh.
   - `docs/04-decisions/INDEX.md` — ambiguity đã chốt (đừng hỏi lại thứ đã có).
   - `docs/05-lessons.md` — gotcha/cạm bẫy đã gặp (đừng lặp lại).
   - `CLAUDE.md` — quy ước dự án.
   File nào chưa tồn tại (dự án mới) → nói rõ "chưa có", không bịa. Mục tiêu: recall là **luôn xảy
   ra**, không phó mặc cho agent tự nhớ đọc — đây chính là tuyến chống *context drift* của TEAM-WORKFLOW.

2. **[TỰ CHẠY] Tạo git branch mới** cho feature: `git checkout -b <NNN>-<feature-slug>`.
   `<NNN>` = **số GitHub issue** của feature, zero-pad tối thiểu 3 chữ số (VD issue #42 →
   `042-user-reservation`). Nếu chưa có issue, DỪNG và yêu cầu người dùng tạo issue trước (dùng
   `Feature` issue template). Số issue là ID toàn cục → tránh trùng khi nhiều người cùng làm.
   Xem `docs/TEAM-WORKFLOW.md`. Spec Kit dùng tên branch để phát hiện feature đang active.

3. **[TỰ CHẠY] Gọi subagent `design-intake`** (qua Task tool) với đường dẫn tài liệu trong
   `docs/01-basic-design/`, `docs/02-detail-design/` và link/node Figma trong `docs/03-ui/`.
   Nó ghi ra `docs/intake/<NNN>-<slug>.md` (khớp tên branch).

4. **[DỪNG]** Hiển thị file intake, đặc biệt mục "Prompt for /speckit-specify" và "Ambiguities".
   Chờ người dùng xác nhận trước khi tiếp tục.

5. **[HANDOFF] specify** — In cho người dùng:
   > Dán và chạy lệnh sau, xong báo tôi:
   > `/speckit-specify <đoạn prompt lấy nguyên từ file intake>`
   Chờ người dùng báo `spec.md` đã sinh xong.

6. **[HANDOFF] clarify** (chỉ khi file intake có "Ambiguities") — In:
   > `/speckit-clarify <các câu hỏi/tiêu điểm lấy từ mục Ambiguities>`
   Lệnh này sẽ hỏi ngược người dùng. Sau khi họ trả lời xong, **[TỰ CHẠY]** ghi câu trả lời vào
   `docs/04-decisions/<YYYY-MM-DD>-<slug>.md` (được phép Write) **và append 1 dòng vào
   `docs/04-decisions/INDEX.md`** rồi tiếp tục.

7. **[HANDOFF] plan** — In: `/speckit-plan` (thêm tech stack/constraint nếu cần). Chờ `plan.md`.

8. **[HANDOFF] tasks** — In: `/speckit-tasks`. Chờ `tasks.md`.

9. **[HANDOFF + DỪNG] analyze** — In: `/speckit-analyze`. Yêu cầu người dùng dán lại kết quả
   cross-artifact analysis. Nếu có vấn đề, quay lại sửa spec/plan/tasks (lặp bước 5–8) **trước khi**
   sang implement. Không đi tiếp khi analyze còn cảnh báo chưa xử lý.

10. **[HANDOFF] implement** — In: `/speckit-implement`. Chờ người dùng báo code đã sinh xong.

11. **[TỰ CHẠY] Gọi subagent `code-reviewer`** (qua Task tool) để đối chiếu code với 4 nguồn
    (constitution, spec, plan, tasks). Mọi mục **Blocking** phải xử lý (thường bằng cách chạy lại
    `/speckit-implement` với yêu cầu sửa cụ thể) trước khi sang test gate.

12. **[TỰ CHẠY] Gọi subagent `glossary-steward`** (qua Task tool) để đối chiếu tên biến/field nghiệp
    vụ trong code + spec với `docs/00-glossary.md`. Term lệch → phải sửa rồi mới đi tiếp; term nghiệp
    vụ **mới** → **append thẳng vào `docs/00-glossary.md` ngay trong branch feature** này (CODEOWNERS
    tự kéo steward review phần glossary khi mở PR — đúng rule 5 `CLAUDE.md`). Chỉ khi cần **SỬA / đổi
    tên / xoá** term đã có mới tách **PR glossary riêng** cho steward duyệt. `glossary-steward` là
    read-only: nó chỉ đề xuất, người phụ trách feature append.

13. **[TỰ CHẠY] Gọi subagent `security-reviewer`** (qua Task tool) — chỉ khi feature đụng auth / dữ
    liệu người dùng / API / DB / crypto / thanh toán (nếu không, agent tự in `SKIPPED`). Nó soi
    OWASP + secret + PII, đối chiếu với `docs/04-decisions/` và constitution. Mọi **Blocking** phải
    xử lý (re-run `/speckit-implement` với yêu cầu fix) trước khi sang test gate.

14. **[DỪNG] Test gate** — Format đã tự chạy qua PostToolUse hook (`.claude/hooks/format.sh`) sau mỗi
    Edit/Write, nên test gate chỉ *verify*: chạy `npm run lint`, `npm run test`, `npm run build`
    (hoặc lệnh tương đương của dự án). **Bắt buộc xanh VÀ coverage đạt ngưỡng constitution**
    (Article W — mặc định ≥ 80% business logic) mới đi tiếp; nếu đỏ hoặc coverage dưới ngưỡng, báo
    và dừng — không deploy. (Tuỳ chọn: chạy `git diff --exit-code` sau format để chắc code đã format
    sạch trước commit.) **Trước khi rời bước này**, nếu trong lúc implement phát hiện gotcha/cạm bẫy
    đặc thù dự án → **append 1 dòng vào `docs/05-lessons.md`** để lần sau không vấp lại.

15. **[DỪNG] Deploy** — Đọc mục **"## Deploy"** trong `CLAUDE.md` để lấy phương thức deploy cụ thể
    của dự án (VD: Vercel, CI/CD, container…). Xác nhận build production ok, rồi thực hiện deploy theo
    đúng phương thức đó. Đây là hành động ra bên ngoài — luôn xin xác nhận rõ ràng trước khi chạy.
    Nếu `CLAUDE.md` chưa khai báo phương thức deploy, DỪNG và hỏi người dùng.

Không tự ý bỏ qua bước [DỪNG]/[HANDOFF] dù người dùng có vẻ vội — luôn chờ xác nhận rõ ràng, và
không bao giờ giả vờ đã chạy `/speckit-*` thay người dùng.
