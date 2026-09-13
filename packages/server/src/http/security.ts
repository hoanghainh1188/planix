/**
 * Header bảo mật — SPEC.md §13.3.
 *
 * §13.3 chốt: HTTPS bắt buộc, HSTS bật. Phần còn lại là những header mà thiếu chúng thì
 * một lỗ XSS ở bất kỳ đâu cũng thành chiếm tài khoản.
 */

export interface SecurityHeaderOptions {
  /**
   * Chỉ gửi HSTS khi thật sự chạy sau HTTPS.
   *
   * Gửi HSTS trên HTTP ở máy dev sẽ khiến trình duyệt GHIM `localhost` vào https trong
   * một năm, và mọi dự án khác dùng localhost cũng hỏng theo. Đây là kiểu lỗi rất khó
   * lần ra vì nó nằm trong trình duyệt, không nằm trong mã.
   */
  readonly enableHsts: boolean;
  /** Nonce cho script, sinh MỚI cho từng request. */
  readonly nonce: string;
}

/**
 * CSP dùng nonce thay vì `'unsafe-inline'`.
 *
 * `connect-src 'self'`: API và UI cùng origin (§13.1 Caddy đứng trước cả hai), nên không
 * cần mở cho origin nào khác. `frame-ancestors 'none'` chặn clickjacking — tool này không
 * bao giờ được nhúng trong iframe của bên khác.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // Style inline cần cho `style` động của virtualizer (vị trí từng dòng).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(options.nonce),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Tool lập lịch không cần quyền nào trong số này.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  if (options.enableHsts) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }
  return headers;
}
