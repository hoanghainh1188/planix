// ⚠️ VÍ DỤ MINH HOẠ PATTERN TEST — XOÁ TRƯỚC KHI DÙNG THẬT.
// Test đặt CẠNH code (co-located) trong src/features/<slug>/. Cú pháp dưới theo Vitest/Jest
// (describe/it/expect) — đổi theo test runner của stack thật. Điều đáng học: mỗi test map tới 1
// acceptance criteria + phủ cả nhánh lỗi (Article W: coverage ≥ 80% business logic).

import { describe, it, expect } from "vitest";
import {
  approveReservation,
  rejectReservation,
  ForbiddenError,
  ValidationError,
  type Reservation,
} from "./approveReservation";

const base: Reservation = {
  id: "r-1",
  status: "pending",
  assigneeId: "assignee-A",
  customerId: "customer-1",
};

describe("approveReservation", () => {
  it("担当者 được gán → chuyển pending sang approved (AC 3)", () => {
    const result = approveReservation(base, "assignee-A");
    expect(result.status).toBe("approved");
  });

  it("không sửa reservation gốc — immutable (coding-style)", () => {
    approveReservation(base, "assignee-A");
    expect(base.status).toBe("pending");
  });

  it("người KHÔNG phải 担当者 được gán → ForbiddenError → 403 (AC 4)", () => {
    expect(() => approveReservation(base, "assignee-B")).toThrow(ForbiddenError);
  });

  it("reservation không ở trạng thái pending → ValidationError", () => {
    const approved: Reservation = { ...base, status: "approved" };
    expect(() => approveReservation(approved, "assignee-A")).toThrow(ValidationError);
  });
});

describe("rejectReservation", () => {
  it("từ chối kèm lý do → chuyển sang rejected (AC 2)", () => {
    const result = rejectReservation(base, "assignee-A", "Hết chỗ");
    expect(result.status).toBe("rejected");
  });

  it("từ chối thiếu lý do → ValidationError (AC 2)", () => {
    expect(() => rejectReservation(base, "assignee-A", "  ")).toThrow(ValidationError);
  });

  it("người khác từ chối hộ → ForbiddenError (AC 4)", () => {
    expect(() => rejectReservation(base, "assignee-B", "x")).toThrow(ForbiddenError);
  });
});
