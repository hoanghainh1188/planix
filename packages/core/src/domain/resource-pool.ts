/**
 * Pool nhân sự cho SGS — SPEC.md §7.5, §7.14.
 *
 * `CLAUDE.md` §5 cảnh báo đích danh: **không được chọn cấu trúc dữ liệu khiến P4 không
 * tối ưu được, ví dụ quét tuyến tính pool nhân sự theo từng ngày.** Vì thế pool ở đây
 * là mảng phẳng đánh chỉ số theo (người, ngày), tra O(1):
 *
 *   30 người × 400 ngày = 12.000 ô. Với §7.14 (6.000 task × 30 người × 400 ngày, ngưỡng
 *   10 giây) thì mỗi lần hỏi "ngày này còn chỗ không" phải là phép tra chỉ số, không
 *   phải vòng lặp trên danh sách assignment.
 *
 * Pool là tài nguyên TOÀN CỤC, dùng chung mọi dự án (§7.12, quyết định ngày 2026-09-12).
 */

import type { CalendarEngine } from './calendar.js';
import { addDays, fromEpochDay, toEpochDay, type DateOnly } from './date-only.js';

export class ResourcePool {
  readonly #engine: CalendarEngine;
  readonly #index = new Map<string, number>();
  readonly #baseEpoch: number;
  readonly #days: number;
  /** Capacity còn lại của từng ô (người, ngày). */
  readonly #remaining: Float64Array;
  /** Số task đang chạy trên ô đó — để ép `max_parallel` (§7.5). */
  readonly #parallel: Int32Array;
  /** Tổng MD đã gán cho từng người, cho RESOURCE_KEY bậc 3 (§7.4). */
  readonly #assignedMd: Float64Array;
  /**
   * Ngày sớm nhất người đó CÒN có thể nhận việc, tính theo offset trong cửa sổ.
   *
   * Đặt chỗ chỉ làm tăng tải, không bao giờ giảm, nên một ngày đã cạn (hết capacity
   * hoặc đủ số task song song) sẽ cạn vĩnh viễn. Nhờ vậy con trỏ này chỉ tiến, và tổng
   * chi phí quét của một người trên toàn bộ lượt xếp là O(cửa sổ) thay vì
   * O(số task × cửa sổ) — đây là thứ đưa 6.000 task × 30 người về dưới ngưỡng §14.2.
   */
  readonly #firstOpen: Int32Array;
  /**
   * Ô nào đang bị một dự án KHÁC chiếm, và là dự án nào.
   *
   * §14.2 P6 đòi `J14` nêu ĐÚNG dự án chiếm chỗ. Không ghi lại nguồn chiếm dụng thì chỉ
   * nói được "hết chỗ", còn PM cần biết nên đi thương lượng với ai.
   */
  readonly #occupiedBy = new Map<number, string>();

  constructor(
    engine: CalendarEngine,
    resourceIds: readonly string[],
    windowStart: DateOnly,
    windowDays: number,
  ) {
    this.#engine = engine;
    this.#baseEpoch = toEpochDay(windowStart);
    this.#days = windowDays;

    resourceIds.forEach((id, i) => this.#index.set(id, i));

    const size = resourceIds.length * windowDays;
    this.#remaining = new Float64Array(size);
    this.#parallel = new Int32Array(size);
    this.#assignedMd = new Float64Array(resourceIds.length);
    this.#firstOpen = new Int32Array(resourceIds.length);

    // Nạp sẵn capacity cả cửa sổ một lần. Engine đã cache theo (calendarId, year) nên
    // đây là chỗ duy nhất phải trả giá, và chỉ trả một lần.
    for (const [id, r] of this.#index) {
      for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
        this.#remaining[r * windowDays + dayOffset] = engine.capacityOn(
          id,
          addDays(windowStart, dayOffset),
        );
      }
    }
  }

  #slot(resourceId: string, date: DateOnly): number | null {
    const r = this.#index.get(resourceId);
    if (r === undefined) throw new Error(`Unknown resource in pool: ${resourceId}`);
    const dayOffset = toEpochDay(date) - this.#baseEpoch;
    if (dayOffset < 0 || dayOffset >= this.#days) return null;
    return r * this.#days + dayOffset;
  }

  /** Capacity còn trống. Ngoài cửa sổ trả 0 — coi như không xếp được. */
  remaining(resourceId: string, date: DateOnly): number {
    const slot = this.#slot(resourceId, date);
    return slot === null ? 0 : (this.#remaining[slot] ?? 0);
  }

  parallelOn(resourceId: string, date: DateOnly): number {
    const slot = this.#slot(resourceId, date);
    return slot === null ? 0 : (this.#parallel[slot] ?? 0);
  }

  assignedMd(resourceId: string): number {
    const r = this.#index.get(resourceId);
    if (r === undefined) throw new Error(`Unknown resource in pool: ${resourceId}`);
    return this.#assignedMd[r] ?? 0;
  }

  #walk(resourceId: string, from: DateOnly, to: DateOnly, allocation: number, sign: 1 | -1): void {
    const r = this.#index.get(resourceId);
    if (r === undefined) throw new Error(`Unknown resource in pool: ${resourceId}`);

    let cursor = from;
    while (cursor <= to) {
      const slot = this.#slot(resourceId, cursor);
      if (slot !== null) {
        const before = this.#remaining[slot] ?? 0;
        // Chỉ đụng ngày thật sự làm việc: đặt chỗ vào ngày nghỉ không tiêu tốn gì,
        // và cũng không được tính vào tổng MD.
        const isWorkingDay = before > 0 || (this.#parallel[slot] ?? 0) > 0;
        if (isWorkingDay) {
          this.#remaining[slot] = before - sign * allocation;
          this.#parallel[slot] = (this.#parallel[slot] ?? 0) + sign;
          this.#assignedMd[r] = (this.#assignedMd[r] ?? 0) + sign * allocation;
        }
      }
      cursor = addDays(cursor, 1);
    }
  }

  reserve(resourceId: string, from: DateOnly, to: DateOnly, allocation: number): void {
    this.#walk(resourceId, from, to, allocation, 1);
  }

  /**
   * Đặt chỗ ĐÚNG những ngày task thật sự làm việc.
   *
   * Khác `reserve` ở chỗ không trừ cả dải `from..to`. Một task trải từ 18/03 tới 23/03
   * không có nghĩa nó chiếm chỗ mọi ngày trong đó: ngày người kia đã kín, hoặc đã chạm
   * `max_parallel`, task chỉ đi qua chứ không tiêu tốn gì.
   *
   * Trừ cả dải sẽ khiến một người bị tính là làm 1.25 ngày công trong một ngày — phép
   * đếm lúc xếp và phép trừ lúc ghi phải khớp nhau, nếu không pool nói dối.
   */
  reserveDays(resourceId: string, days: readonly DateOnly[], allocation: number): void {
    const r = this.#index.get(resourceId);
    if (r === undefined) throw new Error(`Unknown resource in pool: ${resourceId}`);

    for (const day of days) {
      const slot = this.#slot(resourceId, day);
      if (slot === null) continue;
      this.#remaining[slot] = (this.#remaining[slot] ?? 0) - allocation;
      this.#parallel[slot] = (this.#parallel[slot] ?? 0) + 1;
      this.#assignedMd[r] = (this.#assignedMd[r] ?? 0) + allocation;
    }
  }

  /**
   * Đặt chỗ cho một dự án KHÁC, có ghi nguồn.
   *
   * Dùng khi lập lịch dự án ưu tiên thấp hơn: assignment của dự án ưu tiên cao đã ghi
   * vào pool chung và phải được coi là đã chiếm (§7.12).
   */
  reserveExternal(
    resourceId: string,
    from: DateOnly,
    to: DateOnly,
    allocation: number,
    projectId: string,
  ): void {
    this.#walk(resourceId, from, to, allocation, 1);

    const r = this.#index.get(resourceId);
    if (r === undefined) return;
    let cursor = from;
    while (cursor <= to) {
      const slot = this.#slot(resourceId, cursor);
      if (slot !== null) this.#occupiedBy.set(slot, projectId);
      cursor = addDays(cursor, 1);
    }
  }

  /**
   * Dự án nào chiếm chỗ của người này trong khoảng `[from, to]`, nếu có.
   *
   * Trả về dự án gặp SỚM NHẤT: đó là cái đã đẩy task ra khỏi vị trí mong muốn, nên là
   * cái đáng nêu trong `J14`.
   */
  externalBlockerIn(resourceId: string, from: DateOnly, to: DateOnly): string | null {
    let cursor = from;
    while (cursor <= to) {
      const slot = this.#slot(resourceId, cursor);
      if (slot !== null) {
        const owner = this.#occupiedBy.get(slot);
        if (owner !== undefined) return owner;
      }
      cursor = addDays(cursor, 1);
    }
    return null;
  }

  release(resourceId: string, from: DateOnly, to: DateOnly, allocation: number): void {
    this.#walk(resourceId, from, to, allocation, -1);
  }

  /**
   * Ngày làm việc đầu tiên tại hoặc sau `from` mà người này còn đủ `allocation` và chưa
   * chạm `maxParallel`. Hết cửa sổ thì trả `null` — người gọi quyết định làm gì, engine
   * không tự nới ràng buộc (N4).
   */
  firstDayWithRoom(
    resourceId: string,
    from: DateOnly,
    allocation: number,
    maxParallel: number,
  ): DateOnly | null {
    const r = this.#index.get(resourceId);
    if (r === undefined) throw new Error(`Unknown resource in pool: ${resourceId}`);

    const requested = toEpochDay(from) - this.#baseEpoch;
    if (requested >= this.#days) return null;

    // Bắt đầu từ con trỏ "còn chỗ" nếu nó đã vượt qua điểm người gọi hỏi.
    let offset = Math.max(requested, this.#firstOpen[r] ?? 0);
    if (offset < 0) offset = 0;

    const base = r * this.#days;
    let scanningFromHint = offset === (this.#firstOpen[r] ?? 0);

    for (; offset < this.#days; offset++) {
      const room = this.#remaining[base + offset] ?? 0;
      const running = this.#parallel[base + offset] ?? 0;

      // Con trỏ CHỈ được đẩy theo `room <= 0` — điều kiện độc lập với tham số lời gọi.
      //
      // `maxParallel` đến từ người gọi và có thể khác nhau giữa hai lời gọi; đẩy con trỏ
      // theo nó sẽ bỏ sót ngày hợp lệ khi lần sau gọi với giới hạn rộng hơn. `room <= 0`
      // thì đúng là cạn với mọi allocation, và đặt chỗ không bao giờ trả lại capacity.
      //
      // Chỉ đẩy khi đang quét liền mạch từ chính con trỏ: nhảy cóc vì `from` ở xa thì
      // không kết luận được gì về những ngày đã bỏ qua.
      if (room <= 0 && scanningFromHint) this.#firstOpen[r] = offset + 1;
      else if (room > 0) scanningFromHint = false;

      if (room >= allocation && running < maxParallel) {
        return fromEpochDay(this.#baseEpoch + offset);
      }
    }
    return null;
  }

  /** Dùng cho thông điệp lỗi và kiểm tra — không phải đường nóng. */
  get engine(): CalendarEngine {
    return this.#engine;
  }
}
