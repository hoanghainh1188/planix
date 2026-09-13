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

## Triển khai

Image Docker là thứ duy nhất đem đi chạy — §13.1 chốt **một tiến trình Node phục vụ cả
API lẫn UI tĩnh**, nên không tách web ra CDN riêng.

```bash
docker build -t planix .
docker volume create planix-data
docker run --rm -v planix-data:/data planix node packages/server/dist/dev-seed.js /data/project.db
docker run -d -v planix-data:/data -p 3000:3000 planix
```

**Ổ đĩa bền vững là bắt buộc.** SQLite ghi thẳng xuống file; nền tảng nào không cho ghi
bền vững (Vercel và mọi nền serverless khác) sẽ mất toàn bộ lịch sau mỗi lần khởi động
lại. Đã kiểm bằng lệnh: chạy không volume thì container sau không còn thấy file DB.

### Dùng thật ở máy mình

```bash
npm run up          # docker compose, phục vụ ở http://localhost:3000
```

Rồi dựng dữ liệu thật — **không cần SQL**. Đặt `cli` cho gọn:

```bash
cli() { docker compose -f deploy/docker-compose.local.yml exec -T app \
        node packages/server/dist/cli.js "$@"; }

cli bootstrap                                      # lịch VN/JP, địa điểm, lễ Nhật 3 năm
cli add-resource --id R-1 --name 'Nguyen A' --location VN --roles BrSE,Dev
cli create-project --code UTG --name 'UTG' --start 2026-01-05
cli import --project UTG --file /import/tasks.json # đặt file vào deploy/import/

echo -n 'mat-khau-that' | cli create-user --email ban@congty.com --name 'Ten ban' --admin
cli grant --email lead@congty.com --project UTG --role lead --team TM-BE
```

**Mật khẩu đọc từ stdin, không bao giờ từ tham số** — tham số nằm lại trong lịch sử shell
và hiện ra với mọi tiến trình khác qua `ps`.

Sao lưu (§13.2): `cli backup --out /data/backup-$(date +%F).db` — dùng `VACUUM INTO` nên
an toàn cả khi server đang chạy.

`npm run seed:dev` là **dữ liệu demo**, mật khẩu nằm ngay trong mã nguồn. Đừng dùng cho
việc thật.

### Lên nền tảng có quản lý

| Nền tảng | File          | Cần làm trước                                                                                                                     |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Fly.io   | `fly.toml`    | Thêm thẻ (hết hạn dùng thử), rồi `fly apps create planix` + `fly volumes create planix_data --region sin --size 1` + `fly deploy` |
| Render   | `render.yaml` | Dashboard → New → Blueprint → trỏ vào repo. **Disk chỉ có ở gói trả phí** — gói free sẽ mất dữ liệu mỗi lần deploy                |

Cả hai đều tự cấp TLS nên không cần Caddy (§13.1 cách B). Cả hai đều khai **một instance
duy nhất**: SQLite chỉ chịu một tiến trình ghi.

Lên VPS riêng thì dùng `deploy/docker-compose.yml` — Caddy lo HTTPS, Litestream sao lưu
liên tục (§13.2). Lên nền tảng có quản lý (Fly.io, Render) thì bỏ khối `caddy` vì nền
tảng tự cấp TLS, và gắn một volume vào `/data`.

| Biến môi trường | Mặc định            | Việc                                          |
| --------------- | ------------------- | --------------------------------------------- |
| `PLANIX_DB`     | `./data/project.db` | Đường dẫn file SQLite                         |
| `PORT`          | `3000`              | Cổng HTTP                                     |
| `PLANIX_HTTPS`  | `false`             | Bật HSTS — chỉ bật khi THẬT SỰ chạy sau HTTPS |

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
