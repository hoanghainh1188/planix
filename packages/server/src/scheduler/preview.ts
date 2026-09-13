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
import * as issueRepo from '@planix/core/db/repo/issue-repo.js';
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

    if (!result.ok) {
      // Lịch thì KHÔNG ghi (§10.1), nhưng issue thì có.
      //
      // Engine chạy trên bản sao, nên kết quả validate của lượt bị chặn nằm trong file
      // tạm sắp bị xoá. Mà bị chặn chính là lúc PM cần đọc issue nhất — và họ không bao
      // giờ tới được bước xác nhận để engine chạy lại trên DB thật. Không chuyển sang thì
      // panel S6 trống trơn đúng vào lúc dự án hỏng.
      //
      // Chuyển NGUYÊN VĂN từ bản sao chứ không chạy validate lại trên DB thật: đây đúng
      // là bản báo cáo đã chặn lượt chạy, không phải một bản tính lại có thể khác đi.
      carryIssuesFromPreview(copyPath, options.db);
      return { before, after: before, result };
    }

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

/**
 * Mang kết quả validate từ bản sao sang DB thật.
 *
 * Chỉ chuyển những dự án mà bản sao THẬT SỰ có ghi một lượt. Một lượt hỏng vì lý do khác
 * (worker chết, DB in-memory) không ghi gì cả; lúc đó tuyệt đối không được đụng vào DB
 * thật, vì ghi một lượt rỗng lên đó nghĩa là tuyên bố "đã kiểm, sạch" trong khi thực tế
 * là "không kiểm được".
 */
function carryIssuesFromPreview(copyPath: string, target: Db): void {
  const copy = openDatabase(copyPath);
  try {
    for (const projectId of issueRepo.listValidatedProjects(copy)) {
      const run = issueRepo.loadLastValidationRun(copy, projectId);
      if (run === null) continue;
      issueRepo.recordValidationRun(target, {
        runId: run.runId,
        projectId,
        detectedAt: run.ranAt,
        issues: issueRepo.loadRecordedIssues(copy, projectId),
      });
    }
  } finally {
    copy.close();
  }
}
