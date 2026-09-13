import { describe, expect, it } from 'vitest';
import { createProjectStore } from './project-store.js';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe('nhớ dự án đang chọn (§14.2/P8)', () => {
  it('lưu rồi đọc lại được', () => {
    const s = createProjectStore(fakeStorage());
    s.save('P-UTG');
    expect(s.load()).toBe('P-UTG');
  });

  it('chưa lưu gì thì trả null để dùng mặc định', () => {
    expect(createProjectStore(fakeStorage()).load()).toBeNull();
  });

  it('lưu lần sau ghi đè lần trước', () => {
    const s = createProjectStore(fakeStorage());
    s.save('P-UTG');
    s.save('P-GEO');
    expect(s.load()).toBe('P-GEO');
  });

  it('storage ném (chế độ riêng tư) thì KHÔNG làm sập màn hình', () => {
    const hostile = {
      getItem: () => {
        throw new Error('bi chan');
      },
      setItem: () => {
        throw new Error('bi chan');
      },
    } as unknown as Storage;
    const s = createProjectStore(hostile);
    expect(s.load()).toBeNull();
    expect(() => s.save('P-UTG')).not.toThrow();
  });

  it('không có storage (render phía server) thì vẫn chạy', () => {
    const s = createProjectStore(null);
    expect(s.load()).toBeNull();
    expect(() => s.save('P-UTG')).not.toThrow();
  });
});
