# UI reference — link Figma, KHÔNG phải file thiết kế thật

Figma là nguồn UI duy nhất. Mỗi feature 1 thư mục: `docs/03-ui/<slug>/` (`<slug>` khớp branch
`NNN-<slug>` — xem `01-basic-design/README.md`). Trong thư mục chỉ chứa:
- `figma-links.md` — link file/node ID Figma, **ghi rõ mỗi node là màn hình gì** (design-intake
  dựa vào đó để map UI ↔ behavior).
- `screenshots/` — ảnh chụp mốc TẠI THỜI ĐIỂM code được sinh; đây là **fallback** khi không có
  Figma MCP (design-intake sẽ đọc snapshot thay vì gọi Figma trực tiếp).

Format gợi ý cho `figma-links.md`:

```
## <ten-man-hinh>
- Figma node: <link>
- Snapshot ngày: YYYY-MM-DD
- Sinh code từ commit: <git-sha>
```

## Khi UI đổi giữa chừng — `CHANGELOG.md` + "Affected issues"

UI thật nằm ở Figma (versioned bên đó), nhưng khi khách đổi thiết kế đáng kể (đổi luồng màn, thêm/bỏ
field trên UI…), ghi 1 mục vào `CHANGELOG.md` của feature — **cùng quy tắc `01-basic-design` /
`02-detail-design`**. Mục **Affected issues** là **bắt buộc**: liệt kê số issue của feature bị ảnh
hưởng để biết cái nào phải re-run pipeline (TEAM-WORKFLOW mục 8). Cập nhật kèm `Snapshot ngày` mới
trong `figma-links.md`.

```markdown
## v2 — 2026-07-10
- Thay đổi: <đổi gì trên UI so với snapshot trước>
- **Affected issues:** #42, #57   ← bắt buộc
```
