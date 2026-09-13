/**
 * Nhớ dự án PM đang mở — SPEC.md §14.2/P8 "Project switcher, nhớ dự án đang chọn".
 *
 * Đây là tiện nghi RIÊNG của từng máy, không phải dữ liệu dự án, nên `localStorage` là
 * đúng chỗ. Mọi lời gọi đều bọc try/catch: ở chế độ riêng tư trình duyệt ném ngay cả khi
 * chỉ đọc, và làm trắng màn hình vì một thứ vặt như thế này thì không đáng.
 */

const KEY = 'planix.project';

export interface ProjectStore {
  load(): string | null;
  save(projectId: string): void;
}

export function createProjectStore(storage: Storage | null): ProjectStore {
  return {
    load() {
      try {
        return storage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    },
    save(projectId) {
      try {
        storage?.setItem(KEY, projectId);
      } catch {
        /* chế độ riêng tư: bỏ qua */
      }
    },
  };
}
