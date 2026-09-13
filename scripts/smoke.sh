#!/usr/bin/env bash
#
# Chạy thử BẢN BUILD, không phải source.
#
# Lý do tồn tại: `tsc` chỉ dịch `.ts`, nên migration `.sql` và seed lễ `.json` phải được
# chép tay sang `dist/`. Có lần thiếu hẳn thư mục holidays mà toàn bộ test vẫn xanh —
# vitest chạy trên `src/`. Chỉ việc khởi động thật mới lộ ra.
#
# Kiểm: seed dựng được DB (đụng cả .sql lẫn .json trong dist) → server lên → health 200
# → đăng nhập được → tRPC trả dữ liệu → sai mật khẩu bị chặn.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
DB="$WORK/smoke.db"
PORT="${SMOKE_PORT:-3199}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    # `wait` nuot thong bao "Terminated" cua job control, de log CI chi con ket qua that.
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

echo "→ seed (doc .sql va .json tu dist/)"
node "$ROOT/packages/server/dist/dev-seed.js" "$DB" >/dev/null || fail "seed khong chay duoc"

echo "→ khoi dong server da build"
PLANIX_DB="$DB" PORT="$PORT" node "$ROOT/packages/server/dist/index.js" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

curl -fsS "http://localhost:$PORT/api/health" | grep -q '"ok":true' \
  || { cat "$WORK/server.log" >&2; fail "/api/health khong tra ok"; }

echo "→ dang nhap"
curl -fsS -c "$WORK/c.txt" -X POST "http://localhost:$PORT/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"pm@planix.dev","password":"planix-dev-password"}' \
  | grep -q '"ok":true' || fail "dang nhap that bai"

echo "→ tRPC tra du lieu that"
curl -fsS -b "$WORK/c.txt" "http://localhost:$PORT/trpc/projects.list?input=%7B%7D" \
  | grep -q '"code":"UTG"' || fail "projects.list khong tra du an da seed"

curl -fsS -b "$WORK/c.txt" \
  "http://localhost:$PORT/trpc/wbs.tree?input=%7B%22projectId%22%3A%22P-UTG%22%7D" \
  | grep -q '"planStart"' || fail "wbs.tree khong tra lich"

echo "→ sai mat khau phai bi chan"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/api/login" \
  -H 'Content-Type: application/json' -d '{"email":"pm@planix.dev","password":"sai"}')
[ "$code" = "401" ] || fail "sai mat khau tra $code, dang le 401"

echo "SMOKE OK"
