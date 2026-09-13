# syntax=docker/dockerfile:1

# planix — SPEC.md §13.1: MỘT tiến trình Node phục vụ cả API lẫn UI tĩnh.
#
# Giữ đúng thiết kế đó trong image: không tách web ra CDN riêng. §13.1 chọn same-origin
# có chủ đích — nhờ vậy không cần CORS, và cookie phiên `__Host-` + `SameSite=Lax` của
# §13.3 dùng được nguyên vẹn.

# ── Tầng build ──────────────────────────────────────────────────────────────
# `better-sqlite3` là module native. Không có sẵn prebuild cho nền này thì nó biên dịch
# từ nguồn, nên tầng build phải có trình biên dịch. Tầng chạy thì không cần.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy trước mỗi manifest để tầng cache npm không vỡ mỗi lần sửa mã nguồn.
COPY package.json package-lock.json ./
COPY packages/core/package.json   packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json    packages/web/package.json
RUN npm ci

COPY . .
RUN npm run build

# Bỏ dev dependency SAU khi build: typescript và vite chỉ cần lúc dựng.
# `--ignore-scripts` để npm không chạy lại bước biên dịch native vừa xong.
RUN npm prune --omit=dev --ignore-scripts

# ── Tầng chạy ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    PLANIX_DB=/data/project.db

WORKDIR /app

# `node` là user có sẵn trong image chính thức. Chạy bằng root thì một lỗi ghi file
# bất kỳ cũng thành lỗi toàn máy.
COPY --from=build --chown=node:node /app/node_modules      ./node_modules
COPY --from=build --chown=node:node /app/package.json      ./package.json
COPY --from=build --chown=node:node /app/packages/core     ./packages/core
COPY --from=build --chown=node:node /app/packages/server   ./packages/server
COPY --from=build --chown=node:node /app/packages/web/dist ./packages/web/dist

# Thư mục dữ liệu phải là VOLUME. SQLite ghi thẳng xuống file; nền tảng nào không cho
# ghi bền vững thì tool này mất sạch lịch sau mỗi lần khởi động lại.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# Dùng chính endpoint §13 đã có, không thêm cổng phụ cho việc kiểm tra sức khoẻ.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
