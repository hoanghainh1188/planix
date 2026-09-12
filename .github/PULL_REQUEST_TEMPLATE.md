<!-- Quy trình đầy đủ: CLAUDE.md §7. Mở PR khi hết một phase, không phải giữa chừng. -->

## Phase

<!-- VD: P1 — core: schema, importer, validate. Xem SPEC.md §14.1 -->

## Tóm tắt

<!-- Phase này làm được gì. Một bản demo chạy được, không phải code chưa ghép (CLAUDE.md §2). -->

## Checklist nghiệm thu (SPEC.md §14.2)

<!-- Copy nguyên checklist của phase từ SPEC.md §14.2 vào đây, tick từng dòng.
     Dòng nào chưa đạt thì ghi rõ vì sao, đừng tick cho đủ. -->

- [ ]

## Năm nguyên tắc bất biến (SPEC.md §2)

- [ ] **N1** — không có đường nào cho phép AI/người dùng ghi thẳng vào `schedule` / `assignment`
- [ ] **N2** — không `Math.random()` / `Date.now()` trong engine; mọi so sánh có tie-break cuối cùng
- [ ] **N3** — không có handler nào cho phép sửa `start_date` / `end_date`
- [ ] **N4** — xung đột sinh issue, engine không tự phá ràng buộc
- [ ] **N5** — không ghi chéo nhóm bảng

## Chất lượng

- [ ] Golden test xanh — **byte-for-byte**, không "gần đúng"
- [ ] Nếu có sửa `expected.json`: đã tách thành commit riêng, có giải thích vì sao
- [ ] `npm run typecheck` / `lint` / `test` xanh
- [ ] Đã chạy subagent `code-reviewer`, xử lý hết mục **Blocking**
- [ ] Đã chạy `security-reviewer` (nếu phase đụng DB/auth/API) và `glossary-steward`

## Hiệu năng

<!-- Chỉ với phase có ngưỡng: P1 import < 5s, P2 calendar cache < 1s, P4 schedule < 10s.
     Đo trên VPS 2 vCPU, không lấy số của CI runner. Không có ngưỡng thì ghi "không áp dụng". -->

## Chỗ spec chưa rõ đã gặp

<!-- Câu hỏi và cách xử lý. Quyết định đã chốt phải có file trong docs/decisions/
     và một dòng trong docs/decisions/INDEX.md. Không có thì ghi "không có". -->

## Cách chạy thử demo

```bash

```
