import { describe, expect, it } from 'vitest';
import { computeEvm, type EvmTask } from './evm.js';

function t(over: Partial<EvmTask> = {}): EvmTask {
  return {
    uid: 'a',
    baselineMd: 10,
    baselineDurationDays: 10,
    elapsedWorkingDays: 5,
    currentPercent: 50,
    currentStatus: 'in_progress',
    ...over,
  };
}

describe('BCWS — công LẼ RA đã làm theo baseline', () => {
  it('cộng dồn theo tỷ lệ ngày công đã trôi', () => {
    // 10 MD, kế hoạch 10 ngày, đã trôi 5 → lẽ ra làm được 5 MD.
    expect(computeEvm([t({ currentPercent: 0 })]).bcws).toBe(5);
  });

  it('qua hạn thì tính TRỌN, không vượt quá 100%', () => {
    expect(computeEvm([t({ elapsedWorkingDays: 99 })]).bcws).toBe(10);
  });

  it('chưa tới ngày bắt đầu thì bằng 0', () => {
    expect(computeEvm([t({ elapsedWorkingDays: 0 })]).bcws).toBe(0);
  });

  it('mốc thuần (duration 0) không chia cho 0', () => {
    const r = computeEvm([t({ baselineMd: 0, baselineDurationDays: 0 })]);
    expect(Number.isFinite(r.bcws)).toBe(true);
  });
});

describe('BCWP — công ĐÃ làm, tính theo MD của BASELINE', () => {
  it('dùng MD baseline nhân % hiện tại', () => {
    expect(computeEvm([t({ currentPercent: 30 })]).bcwp).toBe(3);
  });

  it('task xong thì tính trọn MD baseline', () => {
    expect(computeEvm([t({ currentPercent: 100, currentStatus: 'done' })]).bcwp).toBe(10);
  });
});

describe('SPI', () => {
  it('làm đúng tiến độ thì bằng 1', () => {
    expect(computeEvm([t({ currentPercent: 50, elapsedWorkingDays: 5 })]).spi).toBe(1);
  });

  it('chậm hơn kế hoạch thì nhỏ hơn 1', () => {
    const spi = computeEvm([t({ currentPercent: 25, elapsedWorkingDays: 5 })]).spi;
    expect(spi).not.toBeNull();
    expect(spi as number).toBeLessThan(1);
  });

  it('nhanh hơn kế hoạch thì lớn hơn 1', () => {
    const spi = computeEvm([t({ currentPercent: 80, elapsedWorkingDays: 5 })]).spi;
    expect(spi as number).toBeGreaterThan(1);
  });

  it('chưa có gì được lên lịch thì trả NULL, không phải 1 hay Infinity', () => {
    // BCWS = 0. Chia cho 0 ra Infinity, mà hiện "SPI ∞" lên màn hình là vô nghĩa.
    expect(computeEvm([t({ elapsedWorkingDays: 0, currentPercent: 0 })]).spi).toBeNull();
  });
});

describe('những thứ KHÔNG được tính vào', () => {
  it('task huỷ bị loại khỏi cả BCWS lẫn BCWP', () => {
    const r = computeEvm([
      t({ uid: 'a', currentStatus: 'cancelled', currentPercent: 0 }),
      t({ uid: 'b', currentPercent: 50 }),
    ]);
    expect(r.bcws).toBe(5);
    expect(r.bcwp).toBe(5);
  });

  it('task thêm SAU baseline không làm tăng BCWP — đó là điểm mấu chốt của EVM', () => {
    // baselineMd = 0 nghĩa là không có trong baseline. Làm xong 100% cũng không được
    // tính là "giá trị đã thu", nếu không thì cứ thêm việc là chỉ số đẹp lên.
    const r = computeEvm([
      t({ uid: 'a', currentPercent: 0, elapsedWorkingDays: 0 }),
      t({ uid: 'new', baselineMd: 0, baselineDurationDays: 0, currentPercent: 100 }),
    ]);
    expect(r.bcwp).toBe(0);
  });

  it('báo riêng khối lượng nằm NGOÀI baseline để thấy scope creep', () => {
    const r = computeEvm([t({ uid: 'a' })], 25);
    expect(r.outsideBaselineMd).toBe(25);
  });
});

describe('tổng hợp', () => {
  it('nhiều task cộng dồn đúng', () => {
    const r = computeEvm([
      t({
        uid: 'a',
        baselineMd: 10,
        baselineDurationDays: 10,
        elapsedWorkingDays: 10,
        currentPercent: 100,
      }),
      t({
        uid: 'b',
        baselineMd: 20,
        baselineDurationDays: 20,
        elapsedWorkingDays: 10,
        currentPercent: 25,
      }),
    ]);
    expect(r.bcws).toBe(20); // 10 + 10
    expect(r.bcwp).toBe(15); // 10 + 5
    expect(r.baselineTotalMd).toBe(30);
  });

  it('danh sách rỗng không làm sập', () => {
    const r = computeEvm([]);
    expect(r.bcws).toBe(0);
    expect(r.bcwp).toBe(0);
    expect(r.spi).toBeNull();
  });
});
