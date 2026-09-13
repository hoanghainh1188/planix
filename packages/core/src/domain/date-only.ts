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

// ── Số học ngày, thuần, không dùng `Date` ────────────────────────────────────
//
// CLAUDE.md §3 cấm `Date` trong domain layer. Ngoài lý do N2 (đồng hồ, múi giờ),
// `Date` còn diễn giải chuỗi theo múi giờ máy chạy: `new Date('2026-03-01')` là UTC
// nhưng `getDay()` trả theo giờ địa phương, nên cùng một chuỗi cho thứ khác nhau ở
// hai máy. Lịch làm việc mà lệch một ngày thì mọi thứ phía sau sai theo.

/** Số ngày từ 1970-01-01 (âm nếu trước đó). Thuật toán lịch Gregorian thuần. */
export function toEpochDay(d: DateOnly): number {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));

  // Howard Hinnant, days_from_civil — chính xác với mọi năm, không dùng thư viện.
  const yAdj = m <= 2 ? y - 1 : y;
  const era = Math.floor(yAdj / 400);
  const yoe = yAdj - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Nghịch đảo của `toEpochDay`. */
export function fromEpochDay(epochDay: number): DateOnly {
  let z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  z = m <= 2 ? y + 1 : y;
  return `${String(z).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateOnly;
}

export function addDays(d: DateOnly, n: number): DateOnly {
  return fromEpochDay(toEpochDay(d) + n);
}

/**
 * Thứ trong tuần, **0 = thứ Hai** … 6 = Chủ nhật.
 *
 * Gốc Hai chứ không phải Chủ nhật vì `calendar.week_pattern` của §4.2 là 7 ký tự
 * Mon..Sun — chỉ số phải khớp trực tiếp, không cần quy đổi ở chỗ dùng.
 */
export function dayOfWeekMon0(d: DateOnly): number {
  // 1970-01-01 là thứ Năm = 3 khi gốc là thứ Hai.
  const dow = (((toEpochDay(d) + 3) % 7) + 7) % 7;
  return dow;
}
