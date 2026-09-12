// ⚠️ VÍ DỤ MINH HOẠ PATTERN — XOÁ TRƯỚC KHI DÙNG THẬT.
// (viết bằng TypeScript vì phổ biến nhất; stack thật của bạn có thể khác.)
//
// Điều đáng học ở đây là *hình dạng*, không phải ngôn ngữ:
//   1. Code riêng của feature nằm trong  src/features/<slug>/  (cô lập — xem CLAUDE.md).
//   2. Domain logic là HÀM THUẦN, không I/O → unit-test được (Article W: TDD + coverage ≥ 80%).
//   3. Tên biến/field bám docs/00-glossary.md:
//        reservation (予約) · approval/approve (承認, KHÔNG "confirm") · assignee (担当者) · customer (顧客).
//   4. Business rule (quyền 担当者, chuyển trạng thái) nằm TRONG hàm thuần, không rải ở controller.
//
// Xoá cả thư mục src/features/example-reservation/ trước khi làm dự án thật.

export type ReservationStatus = "pending" | "approved" | "rejected";

export interface Reservation {
  id: string;
  status: ReservationStatus;
  /** 担当者 (assignee) được gán cho reservation này — chỉ người này được duyệt. */
  assigneeId: string;
  /** 顧客 (customer) sẽ nhận thông báo sau khi approval. */
  customerId: string;
}

/** Ném khi người thao tác không phải 担当者 được gán → tầng route trả 403. */
export class ForbiddenError extends Error {
  constructor(message = "Chỉ 担当者 được gán mới thao tác được reservation này") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Ném khi từ chối mà thiếu lý do bắt buộc. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertAssignee(reservation: Reservation, actorAssigneeId: string): void {
  if (reservation.assigneeId !== actorAssigneeId) {
    throw new ForbiddenError();
  }
}

/**
 * 承認 (approval) một 予約 (reservation) đang chờ.
 * Immutable: trả về bản sao mới, không sửa `reservation` gốc (coding-style: no mutation).
 * AC 2/3/4 của spec.md.
 */
export function approveReservation(
  reservation: Reservation,
  actorAssigneeId: string,
): Reservation {
  assertAssignee(reservation, actorAssigneeId);
  if (reservation.status !== "pending") {
    throw new ValidationError(`Chỉ approval được reservation ở trạng thái "pending"`);
  }
  return { ...reservation, status: "approved" };
}

/**
 * Từ chối một 予約 đang chờ — `reason` bắt buộc (AC 2).
 * Immutable như trên.
 */
export function rejectReservation(
  reservation: Reservation,
  actorAssigneeId: string,
  reason: string,
): Reservation {
  assertAssignee(reservation, actorAssigneeId);
  if (reservation.status !== "pending") {
    throw new ValidationError(`Chỉ từ chối được reservation ở trạng thái "pending"`);
  }
  if (reason.trim() === "") {
    throw new ValidationError("Từ chối bắt buộc kèm lý do");
  }
  return { ...reservation, status: "rejected" };
}
