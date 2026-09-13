/**
 * Kiểm tra một phép đổi cha có hợp lệ không — SPEC.md §10.4, §4.3.
 *
 * §10.1 cho phép kéo thả đổi **cấp bậc và thứ tự** (đó là cấu trúc, không phải ngày, nên
 * không đụng N3). Nhưng cấu trúc sai thì hỏng sâu hơn ngày sai: thả một task vào trong
 * chính con cháu của nó tạo ra một vòng cha-con, và khi đó cả cây không còn gốc — `C08`
 * bắt được, nhưng lúc đó DB đã hỏng rồi.
 *
 * Nên chặn TRƯỚC khi ghi. Hàm thuần, không đọc DB (CLAUDE.md §3).
 */

export interface MovableTask {
  readonly uid: string;
  readonly projectId: string;
  readonly parentUid: string | null;
}

export type MoveRejection = 'unknown-task' | 'unknown-parent' | 'cross-project' | 'cycle' | 'self';

/** `null` nghĩa là đi được. Trả về lý do để lớp trên dịch thành thông báo cho người dùng. */
export function checkMove(
  tasks: readonly MovableTask[],
  taskUid: string,
  newParentUid: string | null,
): MoveRejection | null {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));

  const task = byUid.get(taskUid);
  if (task === undefined) return 'unknown-task';

  if (newParentUid === null) return null; // lên làm gốc: luôn hợp lệ
  if (newParentUid === taskUid) return 'self';

  const parent = byUid.get(newParentUid);
  if (parent === undefined) return 'unknown-parent';
  if (parent.projectId !== task.projectId) return 'cross-project';

  // Đi NGƯỢC từ cha mới lên gốc. Gặp lại chính task đang chuyển nghĩa là cha mới nằm
  // trong cây con của nó — thả xuống là cắt rời cả nhánh khỏi gốc.
  const seen = new Set<string>();
  let cursor: string | null = newParentUid;
  while (cursor !== null) {
    if (cursor === taskUid) return 'cycle';
    // Cây đang hỏng sẵn (đã có vòng) thì dừng, đừng lặp vô hạn.
    if (seen.has(cursor)) return 'cycle';
    seen.add(cursor);
    cursor = byUid.get(cursor)?.parentUid ?? null;
  }
  return null;
}

/** Câu tiếng Anh hiện thẳng lên UI (§10.2). */
export function moveRejectionMessage(reason: MoveRejection): string {
  switch (reason) {
    case 'unknown-task':
      return 'That task no longer exists.';
    case 'unknown-parent':
      return 'The target parent no longer exists.';
    case 'cross-project':
      return 'A task cannot be moved into another project.';
    case 'cycle':
      return 'A task cannot be moved inside one of its own subtasks.';
    case 'self':
      return 'A task cannot be its own parent.';
  }
}
