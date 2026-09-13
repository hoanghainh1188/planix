/**
 * Điểm vào tiến trình server — SPEC.md §13.1.
 *
 * Một tiến trình Node phục vụ API và UI tĩnh; Caddy đứng trước lo HTTPS (§13.2).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import { createApp } from './http/app.js';

const here = dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function main(): void {
  const dbPath = resolve(env('PLANIX_DB', './data/project.db'));
  const port = Number(env('PORT', '3000'));

  // HSTS chỉ bật khi thật sự chạy sau HTTPS. Bật nhầm ở máy dev sẽ ghim `localhost` vào
  // https trong một năm, và mọi dự án khác dùng localhost hỏng theo.
  const enableHsts = env('PLANIX_HTTPS', 'false') === 'true';

  const db = openDatabase(dbPath);
  // Đồng hồ đọc ở ĐÂY, tại biên, rồi truyền vào trong. Core không bao giờ tự đọc (N2).
  migrate(db, new Date().toISOString());

  const app = createApp({ db, dbPath, enableHsts });

  // UI tĩnh: chỉ gắn khi đã build. Thiếu nó thì API vẫn chạy, tiện cho môi trường chỉ
  // cần API (ví dụ chạy MCP riêng).
  const uiRoot = join(here, '..', '..', 'web', 'dist');
  if (existsSync(uiRoot)) {
    app.use('/*', serveStatic({ root: uiRoot }));
    // SPA fallback: mọi đường dẫn không khớp file đều trả index.html để router phía
    // client xử lý. Đặt SAU các route API nên không nuốt mất chúng.
    app.get('*', serveStatic({ path: join(uiRoot, 'index.html') }));
  }

  serve({ fetch: app.fetch, port }, (info) => {
    process.stdout.write(
      `planix listening on :${info.port} · db ${dbPath} · hsts ${String(enableHsts)}\n`,
    );
  });
}

// Chỉ chạy khi được gọi trực tiếp, không chạy khi bị import để test.
if (process.argv[1] !== undefined && process.argv[1].endsWith('index.js')) {
  main();
}
