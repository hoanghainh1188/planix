/**
 * Worker lập lịch — SPEC.md §7.14.
 *
 * Chạy trong worker thread để không chặn API: với 6.000 task, §3.1 đo scheduler chạy
 * trong RAM vài trăm mili-giây, và giữ event loop bận từng ấy nghĩa là mọi request khác
 * phải xếp hàng.
 *
 * Worker mở kết nối SQLite RIÊNG tới cùng file. Không truyền được đối tượng DB qua ranh
 * giới thread, và WAL của §3.1 vốn thiết kế cho nhiều kết nối đọc.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { migrate, openDatabase } from '@planix/core/db/migrate.js';
import {
  scheduleAllProjects,
  scheduleProject,
  ScheduleBlockedError,
} from '@planix/core/pipeline/schedule-project.js';
import type { SchedulerRequest, SchedulerResponse } from './protocol.js';

function run(request: SchedulerRequest): SchedulerResponse {
  const db = openDatabase(request.dbPath);
  try {
    if (request.scope === 'all') {
      const result = scheduleAllProjects(db, {
        runId: request.runId,
        now: request.now,
        ...(request.windowDays === undefined ? {} : { windowDays: request.windowDays }),
      });
      let scheduledCount = 0;
      let assignedCount = 0;
      let writeLockMs = 0;
      let issueCount = 0;
      let projectEnd: string | null = null;
      for (const r of result.perProject.values()) {
        scheduledCount += r.scheduledCount;
        assignedCount += r.assignedCount;
        writeLockMs += r.writeLockMs;
        issueCount += r.issues.length;
        if (r.projectEnd !== null && (projectEnd === null || r.projectEnd > projectEnd)) {
          projectEnd = r.projectEnd;
        }
      }
      return {
        ok: true,
        scheduledCount,
        assignedCount,
        writeLockMs,
        projectEnd,
        issueCount,
        order: result.order,
      };
    }

    const result = scheduleProject(db, {
      projectId: request.projectId,
      runId: request.runId,
      now: request.now,
      ...(request.windowDays === undefined ? {} : { windowDays: request.windowDays }),
    });
    return {
      ok: true,
      scheduledCount: result.scheduledCount,
      assignedCount: result.assignedCount,
      writeLockMs: result.writeLockMs,
      projectEnd: result.projectEnd,
      issueCount: result.issues.length,
    };
  } catch (error) {
    if (error instanceof ScheduleBlockedError) {
      return {
        ok: false,
        name: error.name,
        message: error.message,
        criticalCodes: [
          ...new Set(
            error.report.issues.filter((i) => i.severity === 'Critical').map((i) => i.code),
          ),
        ].sort(),
      };
    }
    // `catch` cho `unknown`; không ép kiểu mà kiểm thật, vì thứ ném ra có thể không
    // phải Error (thư viện native đôi khi ném chuỗi).
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, name, message };
  } finally {
    db.close();
  }
}

// Không chạy gì khi file được import để kiểm kiểu; chỉ chạy khi thật sự là worker.
if (parentPort !== null && workerData !== undefined) {
  parentPort.postMessage(run(workerData as SchedulerRequest));
}

export { run, migrate };
