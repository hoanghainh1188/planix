/**
 * Đọc CSV lịch lễ chính thức của Nhật — 内閣府 (Cabinet Office).
 *
 * Nguồn: https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
 * Định dạng: dòng đầu là header, mỗi dòng sau là `YYYY/M/D,tên lễ`.
 *
 * §5.4 chốt: lễ Nhật có ngày bù (振替休日) phải **nạp từ nguồn chính thức, không tự
 * tính**. File này vì thế chỉ PHÂN TÍCH, không suy luận: không sinh ngày bù, không
 * suy ra lễ nào rơi vào Chủ nhật. Có gì trong file thì nạp đúng thứ đó.
 *
 * ⚠️ File gốc mã hoá **Shift-JIS**, không phải UTF-8. Người gọi phải giải mã trước khi
 * đưa vào đây; truyền thẳng byte vào sẽ cho tên lễ hỏng. Ngày tháng thì không ảnh
 * hưởng vì toàn ký tự ASCII — nghĩa là một bản giải mã sai vẫn cho ngày ĐÚNG và tên
 * SAI, kiểu lỗi lặng lẽ nhất. Đừng tin tên nếu chưa kiểm mã hoá.
 */

import { toDateOnly, type DateOnly } from '../domain/date-only.js';

export interface HolidayEntry {
  readonly date: DateOnly;
  readonly name: string;
}

const ROW = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.*)$/;

export interface ParseHolidayCsvOptions {
  /** Chỉ giữ các năm này. Bỏ trống thì lấy hết. */
  readonly years?: readonly number[];
}

export function parseHolidayCsv(
  text: string,
  options: ParseHolidayCsvOptions = {},
): HolidayEntry[] {
  const wanted = options.years === undefined ? null : new Set(options.years);
  const out: HolidayEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const m = ROW.exec(line);
    if (m === null) continue; // header hoặc dòng rác

    const [, y, mo, da, name] = m;
    if (y === undefined || mo === undefined || da === undefined) continue;

    const year = Number(y);
    if (wanted !== null && !wanted.has(year)) continue;

    const date = toDateOnly(`${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
    if (seen.has(date)) continue; // cùng ngày xuất hiện hai lần thì giữ lần đầu
    seen.add(date);

    out.push({ date, name: (name ?? '').trim() });
  }

  // Sắp theo ngày để kết quả không phụ thuộc thứ tự dòng trong file (N2).
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Các năm thực sự có mặt trong file — dùng để biết nguồn phủ tới đâu. */
export function coveredYears(entries: readonly HolidayEntry[]): number[] {
  return [...new Set(entries.map((e) => Number(e.date.slice(0, 4))))].sort((a, b) => a - b);
}
