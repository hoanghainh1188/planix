/**
 * Cửa duy nhất web nói chuyện với server.
 *
 * Trước đây màn hình lấy dữ liệu từ `mock.ts` vì chưa có HTTP adapter. Nay gọi thật; mock
 * giữ lại cho test và cho việc soi giao diện khi chưa có server.
 */

import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppRouter } from '@planix/server/router/index.js';

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      // Đường dẫn tương đối: UI và API cùng origin (§13.1 — một tiến trình phục vụ cả
      // hai, Caddy đứng trước). Nhờ vậy không cần cấu hình CORS, và `credentials` mặc
      // định của Fetch vốn đã là `same-origin` nên cookie phiên HttpOnly tự được đính
      // kèm — không phải override `fetch`.
      url: '/trpc',
    }),
  ],
});

export type ErrorKind = 'unauthorized' | 'forbidden' | 'offline' | 'unknown';

export interface FriendlyError {
  readonly kind: ErrorKind;
  readonly message: string;
}

/**
 * Đổi lỗi kỹ thuật thành thứ nói được với người dùng.
 *
 * Hiện nguyên `TRPCClientError` lên màn hình là đẩy việc đoán sang người đọc. Bốn loại
 * này đủ để UI biết nên làm gì: đăng nhập lại, báo thiếu quyền, hay thử lại.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | null)?.code;
    if (code === 'UNAUTHORIZED') {
      return { kind: 'unauthorized', message: 'Your session has expired. Please sign in again.' };
    }
    if (code === 'FORBIDDEN') {
      return {
        kind: 'forbidden',
        message: 'You do not have permission for this action in this project.',
      };
    }
    return { kind: 'unknown', message: error.message };
  }
  if (error instanceof TypeError) {
    // fetch ném TypeError khi không nối được — phân biệt với lỗi do server trả về.
    return { kind: 'offline', message: 'Cannot reach the server.' };
  }
  return { kind: 'unknown', message: String(error) };
}
