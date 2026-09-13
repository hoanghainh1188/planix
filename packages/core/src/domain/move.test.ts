import { describe, expect, it } from 'vitest';
import { checkMove, moveRejectionMessage, type MovableTask } from './move.js';

/** root → a → a1, và b ngang hàng với a. */
const tree: MovableTask[] = [
  { uid: 'root', projectId: 'P', parentUid: null },
  { uid: 'a', projectId: 'P', parentUid: 'root' },
  { uid: 'a1', projectId: 'P', parentUid: 'a' },
  { uid: 'a1x', projectId: 'P', parentUid: 'a1' },
  { uid: 'b', projectId: 'P', parentUid: 'root' },
  { uid: 'other', projectId: 'Q', parentUid: null },
];

describe('phép chuyển hợp lệ', () => {
  it('chuyển sang một nhánh khác cùng dự án', () => {
    expect(checkMove(tree, 'a1', 'b')).toBeNull();
  });

  it('đưa lên làm gốc', () => {
    expect(checkMove(tree, 'a1', null)).toBeNull();
  });

  it('giữ nguyên cha cũ vẫn hợp lệ — chỉ đổi thứ tự', () => {
    expect(checkMove(tree, 'a1', 'a')).toBeNull();
  });
});

describe('chặn vòng cha-con — thứ làm hỏng cả cây (§4.3, C08)', () => {
  it('không thả vào CON trực tiếp của chính nó', () => {
    expect(checkMove(tree, 'a', 'a1')).toBe('cycle');
  });

  it('không thả vào CHÁU của chính nó', () => {
    expect(checkMove(tree, 'a', 'a1x')).toBe('cycle');
  });

  it('không tự làm cha của chính mình', () => {
    expect(checkMove(tree, 'a', 'a')).toBe('self');
  });

  it('cây đã hỏng sẵn (có vòng) thì dừng, không lặp vô hạn', () => {
    const broken: MovableTask[] = [
      { uid: 'x', projectId: 'P', parentUid: 'y' },
      { uid: 'y', projectId: 'P', parentUid: 'x' },
      { uid: 'z', projectId: 'P', parentUid: null },
    ];
    expect(() => checkMove(broken, 'z', 'x')).not.toThrow();
    expect(checkMove(broken, 'z', 'x')).toBe('cycle');
  });
});

describe('chặn các trường hợp còn lại', () => {
  it('không chuyển sang dự án khác', () => {
    expect(checkMove(tree, 'a', 'other')).toBe('cross-project');
  });

  it('task không tồn tại', () => {
    expect(checkMove(tree, 'khong-co', 'a')).toBe('unknown-task');
  });

  it('cha không tồn tại', () => {
    expect(checkMove(tree, 'a', 'khong-co')).toBe('unknown-parent');
  });
});

describe('thông báo cho người dùng', () => {
  it('mọi lý do đều có câu tiếng Anh, không lộ mã lỗi', () => {
    for (const reason of [
      'unknown-task',
      'unknown-parent',
      'cross-project',
      'cycle',
      'self',
    ] as const) {
      const msg = moveRejectionMessage(reason);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain(reason);
    }
  });
});
