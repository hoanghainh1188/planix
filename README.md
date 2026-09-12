# planix — WBS Tool

Công cụ Planning & Control cho PM thị trường Nhật. Nhận task list do AI sinh, tính lịch tự
động theo ràng buộc nhân sự và lịch làm việc, theo dõi tiến độ, xuất báo cáo Excel cho
stakeholder.

**Đọc [`SPEC.md`](SPEC.md) trước khi làm bất cứ việc gì.** Đó là nguồn đúng duy nhất.
[`CLAUDE.md`](CLAUDE.md) nói _cách làm việc_, không lặp lại nội dung spec.

## Năm nguyên tắc không được vi phạm

Chi tiết ở `SPEC.md` §2.

1. **N1** — AI chỉ đứng ở hai đầu. Không ghi thẳng vào `schedule` / `assignment`.
2. **N2** — Deterministic. Cùng input ra cùng output, byte-for-byte.
3. **N3** — UI không kéo thả đổi ngày. Ngày là kết quả engine tính.
4. **N4** — Engine không tự phá ràng buộc. Xung đột thì sinh issue, để PM quyết.
5. **N5** — Ba nhóm bảng, ba chủ sở hữu.

## Cấu trúc

```
planix/
├── SPEC.md                     Spec v1.0 — nguồn đúng duy nhất
├── CLAUDE.md                   Quy ước làm việc cho người và agent
├── packages/
│   ├── core/                   Engine thuần, chạy được bằng node, không cần HTTP
│   │   ├── src/db/             schema.sql, migrate.ts, repo/
│   │   ├── src/domain/         calendar, dependency, scheduler, rollup, validator, renumber
│   │   ├── src/io/             importer, excel
│   │   └── tests/fixtures/     20 / 500 / 6.000 task + expected.json
│   ├── server/                 Hono + tRPC, auth, audit, MCP endpoint
│   └── web/                    React SPA
├── deploy/                     docker-compose.yml, Caddyfile, litestream.yml
├── data/                       project.db (không commit)
└── docs/
    ├── 00-glossary.md          Thuật ngữ EN / VI / JA — nguồn dịch cho báo cáo Excel
    ├── 05-lessons.md           Gotcha kỹ thuật gặp khi code
    └── decisions/              Quyết định cho chỗ spec chưa rõ, chờ gộp vào Phụ lục A
```

## Bắt đầu

```bash
npm install
npm run typecheck
npm run test
```

## Lệnh

| Lệnh                  | Việc                                  |
| --------------------- | ------------------------------------- |
| `npm run test`        | Toàn bộ test, gồm golden test         |
| `npm run test:golden` | Chỉ golden test — lưới an toàn cho M2 |
| `npm run typecheck`   | `tsc --build` toàn monorepo           |
| `npm run lint`        | eslint + prettier check               |
| `npm run format`      | prettier --write                      |
| `npm run bench`       | Benchmark hiệu năng                   |

## Cách làm việc

Đọc `CLAUDE.md`. Tóm tắt:

- Làm đúng thứ tự phase ở `SPEC.md` §14.1. **Không nhảy phase.**
- Mỗi phase một nhánh: `feat/p1-schema-importer`, `feat/p4-sgs`, …
- Viết test trước cho phần logic thuần, dựa trên fixture có đáp án.
- Kết thúc phase: chạy đủ checklist §14.2, ghi kết quả vào PR description, PM review.
- Golden test đỏ = không merge, kể cả khi kết quả mới trông hợp lý hơn.
- Gặp chỗ spec chưa rõ: tra Phụ lục A → tra `docs/decisions/` → hỏi PM. Không tự suy diễn.

## Ba mốc kiểm tra

| Mốc   | Sau phase | Điều kiện đi tiếp                            |
| ----- | --------- | -------------------------------------------- |
| **A** | P4        | Lịch engine tính ra PM tin được              |
| **B** | P9        | Team lead nhập tiến độ một tuần dưới 30 phút |
| **C** | P11       | Báo cáo dùng được cho khách                  |

Không đạt Mốc A thì dừng. Không đạt Mốc B thì quay lại bàn về độ mịn WBS.

## Giấy phép

MIT.
