/**
 * Đề xuất tiến độ và ràng buộc nhập liệu cho S4 — SPEC.md §10.5, §7.9.
 *
 * §10.5 gọi S4 là "màn quyết định tool sống hay chết": lead chỉ sửa dòng SAI thực tế,
 * phần còn lại bấm "Accept all". Nếu đề xuất sai nhiều thì lead phải sửa gần hết và màn
 * hình trở nên vô nghĩa — nên logic này nằm ở domain, có test riêng, không nằm rải trong
 * component.
 *
 * Hàm thuần (CLAUDE.md §3): không đọc DB, không đụng `Date`. Số ngày làm việc do lớp gọi
 * tính sẵn bằng CalendarEngine rồi truyền vào — engine mới biết lịch nào áp cho task nào.
 */

import type { ProgressStatus } from './validation-types.js';

export interface SuggestInput {
  readonly planStart: string | null;
  readonly planEnd: string | null;
  readonly statusDate: string;
  /** §7.9: `effort_md <= micro_task_threshold`. Lớp gọi quyết định, không đoán ở đây. */
  readonly isMicro: boolean;
  /** Số ngày LÀM VIỆC theo kế hoạch (`schedule.duration_days`). */
  readonly durationDays: number;
  /**
   * Số ngày làm việc đã trôi, tính từ `planStart` tới TRƯỚC `statusDate`.
   *
   * Không tính chính `statusDate`: ngày hôm đó chưa làm xong. Nhờ vậy đúng ngày bắt đầu
   * là 0%, và ngày cuối cùng là (n-1)/n — chỉ khi qua hạn mới thành 100%.
   */
  readonly elapsedWorkingDays: number;
}

export interface Suggestion {
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
}

/**
 * Điền sẵn một dòng theo bảng §10.5.
 *
 * Micro task chỉ có hai nấc: đã qua hạn thì `done`, còn lại `not_started`. §7.9 cấm
 * `in_progress` cho micro task, nên đề xuất cũng không được sinh ra trạng thái đó.
 */
export function suggestProgress(input: SuggestInput): Suggestion {
  const { planStart, planEnd, statusDate, isMicro } = input;

  // Task chưa xếp lịch thì không có căn cứ nào để đoán.
  if (planStart === null || planEnd === null) {
    return { status: 'not_started', percent: 0, actualStart: null, actualEnd: null };
  }

  // Ngày ISO so sánh theo chuỗi là đúng thứ tự thời gian.
  if (planEnd < statusDate) {
    return { status: 'done', percent: 100, actualStart: planStart, actualEnd: planEnd };
  }

  if (planStart > statusDate) {
    return { status: 'not_started', percent: 0, actualStart: null, actualEnd: null };
  }

  if (isMicro) {
    return { status: 'not_started', percent: 0, actualStart: null, actualEnd: null };
  }

  return {
    status: 'in_progress',
    percent: elapsedPercent(input.elapsedWorkingDays, input.durationDays),
    actualStart: planStart,
    actualEnd: null,
  };
}

/**
 * Làm tròn về SỐ NGUYÊN, không lấy một chữ số thập phân như §7.7.
 *
 * Đây là con số máy đoán để người xác nhận, không phải số đo. Hiện "62.5%" là tạo ảo giác
 * chính xác mà dữ liệu không có — đúng thứ §7.9 đã cảnh báo khi bỏ ô % của micro task.
 */
function elapsedPercent(elapsed: number, duration: number): number {
  if (duration <= 0) return 0;
  const raw = (elapsed / duration) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── Ràng buộc nhập liệu (§10.5) ─────────────────────────────────────────────

export interface ProgressEntry {
  readonly status: ProgressStatus;
  readonly percent: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly blockedNote: string | null;
  readonly isMicro: boolean;
  readonly statusDate: string;
}

/** Ô nào sai — để UI bôi đỏ ĐÚNG ô đó chứ không báo một câu chung chung. */
export type ProgressField = 'status' | 'percent' | 'actualStart' | 'actualEnd' | 'blockedNote';

export interface ProgressEntryError {
  readonly field: ProgressField;
  /** Tiếng Anh — chuỗi này hiện thẳng lên UI (§10.2). */
  readonly message: string;
}

/**
 * §10.5: "chặn TẠI Ô, không đợi lúc lưu".
 *
 * Trả về TẤT CẢ lỗi cùng lúc, không dừng ở cái đầu tiên: lead sửa một vòng là xong, thay
 * vì lưu — báo lỗi — sửa — lưu lại năm lần.
 *
 * Dùng chung cho cả web (chặn ngay khi gõ) và server (không tin client). Cùng một hàm nên
 * hai nơi không thể lệch luật nhau.
 */
export function validateProgressEntry(entry: ProgressEntry): ProgressEntryError[] {
  const errors: ProgressEntryError[] = [];
  const { status, percent, actualStart, actualEnd, blockedNote, isMicro, statusDate } = entry;

  // §7.9 — micro task chỉ có not_started / done / cancelled.
  if (isMicro && (status === 'in_progress' || status === 'blocked')) {
    errors.push({
      field: 'status',
      message: `Micro tasks cannot be ${status.replace('_', ' ')}. Use Done or Not started.`,
    });
  }

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    errors.push({ field: 'percent', message: 'Percent must be between 0 and 100.' });
  }

  // §10.5 chỉ chặn `actual_start` ở tương lai, KHÔNG chặn `actual_end`. Đừng tự thêm
  // luật thứ hai: CLAUDE.md §8 cấm thêm thứ spec không yêu cầu. Câu hỏi "báo actual_end
  // sau status_date có hợp lệ không" đã gửi PM, xem PR của P9.
  if (actualStart !== null && actualStart > statusDate) {
    errors.push({
      field: 'actualStart',
      message: `Actual start cannot be after the status date (${statusDate}).`,
    });
  }

  if (actualStart !== null && actualEnd !== null && actualEnd < actualStart) {
    errors.push({ field: 'actualEnd', message: 'Actual end cannot be before actual start.' });
  }

  // PM quyết 2026-09-13: chặn như lỗi nhập liệu.
  //
  // Tình huống có thật: task quá hạn được đề xuất `done` 100%, lead bấm `P` vì thực tế
  // chưa xong, và `percent` giữ nguyên 100. Khi đó §7.11 tính
  // `remaining_md = effort_md × (1 − 100/100) = 0` cho một task CHƯA xong, còn rollup
  // §7.7 cộng dồn 100%. Bắt ngay tại ô thì lead sửa một lần, thay vì con số vô lý đi
  // thẳng xuống báo cáo cho khách.
  if (status === 'in_progress' && percent === 100) {
    errors.push({
      field: 'percent',
      message: 'An in-progress task cannot be 100%. Mark it done, or lower the percent.',
    });
  }

  if (status === 'blocked' && (blockedNote === null || blockedNote.trim() === '')) {
    errors.push({ field: 'blockedNote', message: 'A blocked task needs a note saying why.' });
  }

  // Xong mà không có ngày xong thì báo cáo và re-forecast (§7.11) mất mốc để bám.
  if (status === 'done' && actualEnd === null) {
    errors.push({ field: 'actualEnd', message: 'A done task needs an actual end date.' });
  }

  return errors;
}
