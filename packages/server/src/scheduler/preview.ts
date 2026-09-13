/**
 * Chạy thử lịch trên BẢN SAO của DB — SPEC.md §10.1.
 *
 * §10.1: "Trước khi ghi kết quả recalculate, hiện bảng so sánh trước/sau: task nào trượt,
 * trượt mấy ngày, ngày kết thúc dự án đổi bao nhiêu, dự án nào bị ảnh hưởng. PM xác nhận
 * rồi mới lưu."
 *
 * Không có cách nào "chạy rồi hoàn tác": worker mở kết nối DB riêng ở thread khác, nên
 * transaction của tiến trình chính không bao được nó. Giải pháp là sao DB ra một file tạm
 * rồi cho worker chạy trên đó — DB thật không bị đụng tới một byte nào.
 *
 * M2 (cùng đầu vào ra cùng đầu ra, byte-for-byte) là thứ khiến cách này dùng được: lần
 * chạy thật sau khi PM bấm xác nhận cho ra đúng kết quả vừa xem.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@planix/core/db/migrate.js';
import { openDatabase } from '@planix/core/db/migrate.js';
import * as read from '@planix/core/db/repo/read-repo.js';
import { runSchedulerInWorker } from './run-in-worker.js';
import type { SchedulerRequest, SchedulerResponse } from './protocol.js';

export interface PreviewResult {
  /** Lịch hiện tại của MỌI dự án (§10.1 gộp mọi dự án bị ảnh hưởng, R9). */
  readonly before: readonly read.ScheduleSnapshotRow[];
  /** Lịch engine vừa tính ra, chưa ghi vào DB thật. */
  readonly after: readonly read.ScheduleSnapshotRow[];
  readonly result: SchedulerResponse;
}

export interface PreviewOptions {
  readonly db: Db;
  readonly dbPath: string;
  readonly projectId: string;
  readonly scope: 'project' | 'all';
  readonly now: string;
  /**
   * Cách chạy engine. Mặc định là worker thread (§7.14).
   *
   * Cho phép thay để test gọi thẳng `run()` — worker thread cần `worker.js` đã build,
   * và bắt test phải build trước là cách chắc chắn để một ngày nào đó test kiểm nhầm
   * một bản cũ.
   */
  readonly runScheduler?: (request: SchedulerRequest) => Promise<SchedulerResponse>;
}

export async function previewRecalculate(options: PreviewOptions): Promise<PreviewResult> {
  const before = read.loadScheduleSnapshot(options.db);

  // DB in-memory không sao ra file được, nên không chạy thử được. Nói thẳng thay vì trả
  // về một bảng so sánh rỗng trông như "không có gì đổi".
  if (options.dbPath === ':memory:') {
    return {
      before,
      after: before,
      result: {
        ok: false,
        name: 'PreviewUnavailable',
        message: 'Preview needs a file-backed database; this server is running in memory.',
      },
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'planix-preview-'));
  const copyPath = join(dir, 'preview.db');

  try {
    // `VACUUM INTO` chụp một bản nhất quán ngay cả khi WAL đang có giao dịch dở.
    options.db.prepare('VACUUM INTO ?').run(copyPath);

    const runner = options.runScheduler ?? runSchedulerInWorker;
    const result = await runner({
      dbPath: copyPath,
      projectId: options.projectId,
      scope: options.scope,
      runId: `preview-${options.now}`,
      now: options.now,
    });

    if (!result.ok) return { before, after: before, result };

    const copy = openDatabase(copyPath);
    try {
      return { before, after: read.loadScheduleSnapshot(copy), result };
    } finally {
      copy.close();
    }
  } finally {
    // Dọn cả thư mục: SQLite để lại `-wal` và `-shm` bên cạnh file chính.
    rmSync(dir, { recursive: true, force: true });
  }
}
