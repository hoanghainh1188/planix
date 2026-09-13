/**
 * Băm mật khẩu — SPEC.md §13.3 chốt **argon2id**.
 *
 * Tham số để mặc định của thư viện, vốn theo khuyến nghị OWASP. Không tự hạ xuống cho
 * nhanh: chậm là mục đích của hàm băm mật khẩu.
 */

import { hash, verify } from '@node-rs/argon2';

export interface PasswordOptions {
  /** Chỉ dùng trong test để chạy nhanh. KHÔNG hạ ở môi trường thật. */
  readonly memoryCost?: number;
  readonly timeCost?: number;
}

/**
 * Thuật toán KHÔNG khai tường minh vì `Algorithm` của thư viện là ambient const enum,
 * không dùng được với `verbatimModuleSyntax`. Mặc định của `@node-rs/argon2` là argon2id,
 * và test khẳng định hash bắt đầu bằng `$argon2id$` — nếu thư viện đổi mặc định thì test
 * đỏ ngay, không im lặng tụt xuống argon2i.
 */
export async function hashPassword(plain: string, options: PasswordOptions = {}): Promise<string> {
  return hash(plain, {
    ...(options.memoryCost === undefined ? {} : { memoryCost: options.memoryCost }),
    ...(options.timeCost === undefined ? {} : { timeCost: options.timeCost }),
  });
}

/**
 * So mật khẩu. Trả `false` thay vì ném khi hash hỏng.
 *
 * Hash hỏng trong DB không được biến thành lỗi 500 lộ ra ngoài — với người thử mật khẩu,
 * phân biệt được "lỗi hệ thống" và "sai mật khẩu" đã là một mẩu thông tin.
 */
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
