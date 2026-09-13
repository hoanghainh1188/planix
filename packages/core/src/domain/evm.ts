/**
 * Earned Value ở mức SPI — chỉ số tiến độ.
 *
 * PM chốt 2026-09-13: **chỉ làm SPI, chưa làm CPI**. CPI cần ACWP (chi phí thực tế), mà
 * bảng `progress` không lưu công thực tế đã bỏ ra — và §1.3 cấm cho dev truy cập, nên số
 * đó sẽ phải do lead nhập, tức thêm việc cho đúng người mà §10.5 đang cố giảm tải (R1).
 *
 * Ba đại lượng, đơn vị **MD** (không phải tiền — schema chưa có mô hình chi phí):
 *
 *   BCWS  công LẼ RA đã làm tới `status_date`, theo baseline
 *   BCWP  công ĐÃ làm, tính theo MD của BASELINE nhân % hiện tại
 *   SPI   BCWP / BCWS
 *
 * Hàm thuần (CLAUDE.md §3): số ngày công do lớp gọi tính sẵn bằng CalendarEngine.
 */

import type { ProgressStatus } from './validation-types.js';

export interface EvmTask {
  readonly uid: string;
  /**
   * MD theo BASELINE, không phải MD hiện tại.
   *
   * Đây là điểm mấu chốt của EVM: nếu dùng MD hiện tại thì nới phạm vi sẽ tự làm đẹp
   * chỉ số. `0` nghĩa là task không có trong baseline — thêm vào sau khi chốt.
   */
  readonly baselineMd: number;
  /** Số ngày công theo kế hoạch trong baseline. */
  readonly baselineDurationDays: number;
  /**
   * Ngày công đã trôi từ ngày bắt đầu trong baseline tới `status_date`, nửa khoảng.
   *
   * Cùng quy ước với đề xuất của §10.5: không tính chính `status_date`, nên đúng ngày
   * bắt đầu là 0% chứ không phải đã làm được một ngày.
   */
  readonly elapsedWorkingDays: number;
  readonly currentPercent: number;
  readonly currentStatus: ProgressStatus;
}

export interface EvmResult {
  /** Planned Value, MD. */
  readonly bcws: number;
  /** Earned Value, MD. */
  readonly bcwp: number;
  /** `null` khi BCWS = 0 — chia cho 0 ra Infinity, hiện "SPI ∞" là vô nghĩa. */
  readonly spi: number | null;
  readonly baselineTotalMd: number;
  /** MD của việc có trong kế hoạch hiện tại nhưng KHÔNG có trong baseline. */
  readonly outsideBaselineMd: number;
}

/** Làm tròn 2 chữ số để hai lần tính ra cùng một chuỗi hiển thị. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeEvm(tasks: readonly EvmTask[], outsideBaselineMd = 0): EvmResult {
  let bcws = 0;
  let bcwp = 0;
  let total = 0;

  for (const task of tasks) {
    // §6.5 gỡ task huỷ khỏi mạng lưới; nó cũng không thuộc về phép đo tiến độ.
    if (task.currentStatus === 'cancelled') continue;
    if (task.baselineMd <= 0) continue;

    total += task.baselineMd;

    const ratio =
      task.baselineDurationDays <= 0
        ? // Mốc thuần: không có độ dài để chia, nên coi là đã tới hạn khi đã có ngày trôi.
          task.elapsedWorkingDays > 0
          ? 1
          : 0
        : Math.min(1, Math.max(0, task.elapsedWorkingDays / task.baselineDurationDays));

    bcws += task.baselineMd * ratio;
    bcwp += task.baselineMd * (Math.min(100, Math.max(0, task.currentPercent)) / 100);
  }

  return {
    bcws: round2(bcws),
    bcwp: round2(bcwp),
    spi: bcws === 0 ? null : round2(bcwp / bcws),
    baselineTotalMd: round2(total),
    outsideBaselineMd: round2(outsideBaselineMd),
  };
}
