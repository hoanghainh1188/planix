/**
 * Tên gợi ý cho baseline sắp chốt — §7.13.
 *
 * Tách khỏi component để có chỗ kiểm: bản đầu tiên PHẢI là `Plan v1.0`, vì §7.13 gọi nó
 * là mốc cam kết và mọi so sánh scope creep về sau dựa vào nó. Đánh số lệch một bậc là
 * làm hai dự án nói về hai thứ khác nhau dưới cùng một cái tên.
 *
 * Chỉ là GỢI Ý. PM sửa được, và cách đặt tên là việc của PM.
 */
export function suggestedBaselineLabel(existingCount: number): string {
  const safe = Number.isFinite(existingCount) && existingCount > 0 ? Math.floor(existingCount) : 0;
  return `Plan v1.${String(safe)}`;
}
