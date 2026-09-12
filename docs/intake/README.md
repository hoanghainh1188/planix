# Intake — output của subagent design-intake

Đây là "cầu nối" giữa tài liệu Nhật/Figma và Spec Kit.
Mỗi feature 1 file: `docs/intake/<NNN>-<slug>.md` (**`<NNN>-<slug>` khớp tên branch** `NNN-<slug>` →
tránh trùng slug khi nhiều feature song song). Gồm:
- Input sources (đường dẫn docs + Figma)
- Prompt for /speckit-specify (copy-paste vào Claude Code)
- Ambiguities to raise in /speckit-clarify
- Thuật ngữ mới (append vào glossary)
- Suggested constitution amendments

File này commit vào Git — bằng chứng agent đã hiểu đúng tài liệu Nhật tại thời điểm sinh spec.

---

## Handoff checklist — chỉ dùng khi BUỘC phải chuyển tay giữa chừng

Nguyên tắc: **1 người sở hữu 1 feature end-to-end** (xem `docs/TEAM-WORKFLOW.md` mục 3). Pipeline
`/design-to-code` không có điểm bàn giao — chuyển tay giữa dòng dễ mất ngữ cảnh intake. Nếu thật sự
phải chuyển (nghỉ phép, đổi người), người giao **append block dưới vào cuối file intake của feature**
để người nhận nạp lại ngữ cảnh mà không phải hỏi từ đầu:

```markdown
## Handoff — <ngày> · từ <người giao> → <người nhận>
- **Đang ở bước pipeline:** <VD: đã xong /speckit-tasks, chưa chạy /speckit-analyze>
- **Branch / issue:** NNN-<slug> · #<issue>
- **Đã chốt:** <link các docs/04-decisions/* đã tạo cho feature này>
- **Ambiguities còn treo:** <câu nào chưa được /speckit-clarify trả lời>
- **Term mới đã append glossary:** <có/không — dòng nào>
- **Việc còn lại + cạm bẫy:** <bước kế tiếp, chỗ dễ sai, ràng buộc từ khách>
- **Trạng thái code/test:** <src/features/<slug>/ đến đâu, test gate xanh/đỏ>
```

Người nhận: đọc `docs/intake/<NNN>-<slug>.md` + block handoff + `docs/04-decisions/INDEX.md` trước
khi chạy tiếp — **không** khởi động lại pipeline từ `design-intake` nếu intake vẫn còn hiệu lực.
