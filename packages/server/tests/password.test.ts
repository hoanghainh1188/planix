import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

// Tham so thap de test chay nhanh; moi truong that dung mac dinh cua thu vien.
const FAST = { memoryCost: 8, timeCost: 1 };

describe('băm mật khẩu (§13.3 argon2id)', () => {
  it('hash rồi verify được', async () => {
    const h = await hashPassword('mat-khau-rat-dai-va-kho-doan', FAST);
    expect(await verifyPassword('mat-khau-rat-dai-va-kho-doan', h)).toBe(true);
  });

  it('mật khẩu sai thì false', async () => {
    const h = await hashPassword('dung', FAST);
    expect(await verifyPassword('sai', h)).toBe(false);
  });

  it('dùng argon2id, không phải biến thể khác', async () => {
    const h = await hashPassword('x', FAST);
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('hai lần băm cùng mật khẩu cho hai hash KHÁC nhau (có salt)', async () => {
    const a = await hashPassword('giong-nhau', FAST);
    const b = await hashPassword('giong-nhau', FAST);
    expect(a).not.toBe(b);
    expect(await verifyPassword('giong-nhau', a)).toBe(true);
    expect(await verifyPassword('giong-nhau', b)).toBe(true);
  });

  it('hash hỏng trong DB trả false, KHÔNG ném — không để lộ lỗi hệ thống', async () => {
    expect(await verifyPassword('x', 'khong-phai-hash')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
