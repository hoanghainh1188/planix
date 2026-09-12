/**
 * Kiểu ngày dùng xuyên suốt domain layer.
 *
 * CLAUDE.md §3 chốt: domain layer KHÔNG dùng `Date`. Lý do không chỉ là sở thích —
 * `Date` mang theo giờ, múi giờ và đồng hồ hệ thống, cả ba đều phá N2 (deterministic).
 * Toàn hệ thống làm việc theo ngày làm việc, bước nhảy 0.5, không dùng giờ (SPEC.md §5.5).
 */

declare const dateOnlyBrand: unique symbol;

/** Ngày dạng `YYYY-MM-DD`. Chỉ tạo được qua `toDateOnly` / `unsafeDateOnly`. */
export type DateOnly = string & { readonly [dateOnlyBrand]: 'DateOnly' };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kiểm tra chuỗi có phải `YYYY-MM-DD` hợp lệ không — gồm cả việc ngày có thật
 * (bắt `2026-02-30`, `2026-13-01`).
 */
export function isDateOnly(value: string): value is DateOnly {
  if (!DATE_ONLY_RE.test(value)) return false;

  // Tách tay thay vì dựa vào Date.parse: Date.parse chấp nhận nhiều dạng lệch chuẩn
  // và tự "sửa" ngày tràn (2026-02-30 → 2026-03-02), đúng thứ cần bắt.
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Ép kiểu sau khi đã validate. Ném lỗi nếu chuỗi không hợp lệ. */
export function toDateOnly(value: string): DateOnly {
  if (!isDateOnly(value)) {
    throw new RangeError(`Invalid DateOnly: ${JSON.stringify(value)}. Expected YYYY-MM-DD.`);
  }
  return value;
}

/**
 * Dùng cho literal đã biết chắc đúng lúc viết code (fixture, seed, hằng số).
 * Vẫn kiểm ở dev; không dùng cho dữ liệu đến từ ngoài — dữ liệu ngoài đi qua zod.
 */
export function unsafeDateOnly(value: string): DateOnly {
  return value as DateOnly;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * So sánh hai ngày. Vì định dạng `YYYY-MM-DD` có độ dài cố định và các trường
 * zero-pad, so sánh chuỗi trùng khớp với so sánh thời gian — không cần parse.
 *
 * Hàm này là tie-break cuối cùng ở nhiều chỗ trong scheduler (SPEC.md §7.4), nên
 * nó phải toàn phần và ổn định.
 */
export function compareDateOnly(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
