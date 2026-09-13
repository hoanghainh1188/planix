/**
 * Gọi worker lập lịch từ tiến trình chính — SPEC.md §7.14.
 */

import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SchedulerRequest, SchedulerResponse } from './protocol.js';

/**
 * Đường dẫn worker, mặc định là file `.js` cạnh module này sau khi build.
 *
 * Worker thread không hiểu TypeScript, nên ở môi trường chạy thật nó phải trỏ vào
 * `dist`. Cho phép truyền đường dẫn khác để test thay bằng worker giả, thay vì bắt test
 * phải build trước.
 */
function defaultWorkerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'worker.js');
}

export interface RunInWorkerOptions {
  readonly workerPath?: string;
  /** Chặn trên thời gian chạy. Quá ngưỡng thì huỷ worker thay vì treo API. */
  readonly timeoutMs?: number;
}

export async function runSchedulerInWorker(
  request: SchedulerRequest,
  options: RunInWorkerOptions = {},
): Promise<SchedulerResponse> {
  const workerPath = options.workerPath ?? defaultWorkerPath();
  const timeoutMs = options.timeoutMs ?? 60_000;

  return new Promise<SchedulerResponse>((resolve) => {
    const worker = new Worker(workerPath, { workerData: request });
    let settled = false;

    const finish = (response: SchedulerResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(response);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        name: 'SchedulerTimeout',
        message: `Scheduler worker exceeded ${timeoutMs} ms and was terminated.`,
      });
    }, timeoutMs);

    worker.on('message', (message: SchedulerResponse) => finish(message));
    worker.on('error', (error: Error) =>
      finish({ ok: false, name: error.name, message: error.message }),
    );
    worker.on('exit', (code) => {
      // Thoát mà chưa gửi message nào: worker chết giữa chừng.
      finish({
        ok: false,
        name: 'SchedulerWorkerExit',
        message: `Scheduler worker exited with code ${code} before sending a result.`,
      });
    });
  });
}
