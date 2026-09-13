import { describe, expect, it } from 'vitest';
import { createCalendarEngine, type CalendarSnapshot } from './calendar.js';
import { runCpm, type CpmTask } from './cpm.js';
import type { DepEdge } from './dependency.js';
import { unsafeDateOnly as d } from './date-only.js';

/** Lịch T2-T6, không lễ — để mọi con số dưới đây tính tay được. */
const CAL: CalendarSnapshot = {
  calendars: [{ id: 'CAL', scope: 'project', parentId: null, weekPattern: '1111100' }],
  exceptions: [],
  locations: [{ id: 'VN', calendarId: 'CAL' }],
  resources: [],
};
const engine = createCalendarEngine(CAL);

// 2026-05-04 la thu Hai. 05-09 va 05-10 la cuoi tuan.
const MON = d('2026-05-04');

function task(uid: string, durationDays: number, over: Partial<CpmTask> = {}): CpmTask {
  return { uid, durationDays, constraintType: null, constraintDate: null, ...over };
}

function run(tasks: CpmTask[], edges: DepEdge[] = []) {
  return runCpm({ tasks, edges, projectStart: MON, calendarId: 'CAL', engine });
}

describe('runCpm — một task', () => {
  it('duration 2 bắt đầu thứ Hai thì kết thúc thứ Ba', () => {
    const r = run([task('A', 2)]);
    expect(r.get('A')).toMatchObject({ es: '2026-05-04', ef: '2026-05-05' });
  });

  it('duration 1 thì bắt đầu và kết thúc cùng ngày', () => {
    expect(run([task('A', 1)]).get('A')).toMatchObject({ es: '2026-05-04', ef: '2026-05-04' });
  });

  it('duration 0 (mốc thuần §7.10) thì EF = ES', () => {
    expect(run([task('M', 0)]).get('M')).toMatchObject({ es: '2026-05-04', ef: '2026-05-04' });
  });

  it('duration nhảy qua cuối tuần', () => {
    // 5 ngay lam tu T2 04/05 -> T6 08/05
    expect(run([task('A', 5)]).get('A')).toMatchObject({ ef: '2026-05-08' });
    // 6 ngay -> T2 11/05
    expect(run([task('A', 6)]).get('A')).toMatchObject({ ef: '2026-05-11' });
  });

  it('task đơn lẻ có float 0 và nằm trên critical path', () => {
    expect(run([task('A', 2)]).get('A')).toMatchObject({ totalFloat: 0, isCritical: true });
  });
});

describe('runCpm — FS (§6.1)', () => {
  it('lag 0: successor bắt đầu ngày làm kế tiếp sau khi predecessor xong', () => {
    const r = run(
      [task('A', 2), task('B', 3)],
      [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
    );
    expect(r.get('A')).toMatchObject({ es: '2026-05-04', ef: '2026-05-05' });
    expect(r.get('B')).toMatchObject({ es: '2026-05-06', ef: '2026-05-08' });
  });

  it('lag dương chèn thêm ngày làm việc', () => {
    const r = run(
      [task('A', 1), task('B', 1)],
      [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 2 }],
    );
    // A xong T2 04/05; +2 ngay lam -> B bat dau T5 07/05
    expect(r.get('B')).toMatchObject({ es: '2026-05-07' });
  });

  it('lag âm cho phép chồng lấn (lead §6.1)', () => {
    const r = run(
      [task('A', 3), task('B', 2)],
      [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: -1 }],
    );
    // A: 04-06. FS lag 0 -> B bat dau 07; lag -1 -> lui 1 ngay lam -> 06
    expect(r.get('B')).toMatchObject({ es: '2026-05-06' });
  });

  it('chuỗi qua cuối tuần', () => {
    const r = run(
      [task('A', 5), task('B', 1)],
      [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
    );
    // A: T2 04 -> T6 08. B bat dau T2 11 (bo qua T7, CN)
    expect(r.get('B')).toMatchObject({ es: '2026-05-11' });
  });

  it('nhiều predecessor thì lấy ràng buộc muộn nhất', () => {
    const r = run(
      [task('A', 1), task('B', 5), task('C', 1)],
      [
        { predUid: 'A', succUid: 'C', type: 'FS', lagDays: 0 },
        { predUid: 'B', succUid: 'C', type: 'FS', lagDays: 0 },
      ],
    );
    // B xong T6 08/05 -> C bat dau T2 11/05
    expect(r.get('C')).toMatchObject({ es: '2026-05-11' });
  });
});

describe('runCpm — SS, FF, SF (§6.1)', () => {
  it('SS: successor bắt đầu không sớm hơn predecessor bắt đầu + lag', () => {
    const r = run(
      [task('A', 5), task('B', 2)],
      [{ predUid: 'A', succUid: 'B', type: 'SS', lagDays: 2 }],
    );
    // A bat dau T2 04; +2 ngay lam -> B bat dau T4 06
    expect(r.get('B')).toMatchObject({ es: '2026-05-06' });
  });

  it('FF: quy về start bằng cách trừ duration của successor (§6.1)', () => {
    const r = run(
      [task('A', 5), task('B', 2)],
      [{ predUid: 'A', succUid: 'B', type: 'FF', lagDays: 0 }],
    );
    // A xong T6 08. B phai xong khong som hon 08, duration 2 -> bat dau T5 07
    expect(r.get('B')).toMatchObject({ es: '2026-05-07', ef: '2026-05-08' });
  });

  it('SF: successor kết thúc không sớm hơn predecessor bắt đầu + lag', () => {
    const r = run(
      [task('A', 5), task('B', 2)],
      [{ predUid: 'A', succUid: 'B', type: 'SF', lagDays: 0 }],
    );
    // A bat dau T2 04 -> B phai xong khong som hon 04; duration 2 -> som nhat van la 04-05
    expect(r.get('B')).toMatchObject({ es: '2026-05-04', ef: '2026-05-05' });
  });
});

describe('runCpm — float và critical path (§7.2)', () => {
  it('nhánh ngắn song song có float dương, nhánh dài có float 0', () => {
    // A -> {B ngan, C dai} -> D
    const r = run(
      [task('A', 1), task('B', 1), task('C', 4), task('D', 1)],
      [
        { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
        { predUid: 'A', succUid: 'C', type: 'FS', lagDays: 0 },
        { predUid: 'B', succUid: 'D', type: 'FS', lagDays: 0 },
        { predUid: 'C', succUid: 'D', type: 'FS', lagDays: 0 },
      ],
    );
    expect(r.get('A')?.totalFloat).toBe(0);
    expect(r.get('C')?.totalFloat).toBe(0);
    expect(r.get('D')?.totalFloat).toBe(0);
    // B ngan hon C 3 ngay lam viec
    expect(r.get('B')?.totalFloat).toBe(3);

    expect(r.get('A')?.isCritical).toBe(true);
    expect(r.get('C')?.isCritical).toBe(true);
    expect(r.get('B')?.isCritical).toBe(false);
  });

  it('mọi task đều critical khi chỉ có một chuỗi', () => {
    const r = run(
      [task('A', 1), task('B', 1), task('C', 1)],
      [
        { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
        { predUid: 'B', succUid: 'C', type: 'FS', lagDays: 0 },
      ],
    );
    for (const uid of ['A', 'B', 'C']) {
      expect(r.get(uid)).toMatchObject({ totalFloat: 0, isCritical: true });
    }
  });

  it('LS/LF khớp với ES/EF trên đường găng', () => {
    const r = run(
      [task('A', 2), task('B', 3)],
      [{ predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 }],
    );
    expect(r.get('A')?.ls).toBe(r.get('A')?.es);
    expect(r.get('A')?.lf).toBe(r.get('A')?.ef);
    expect(r.get('B')?.ls).toBe(r.get('B')?.es);
  });
});

describe('runCpm — ràng buộc ngày (§6.6)', () => {
  it('SNET đẩy ES muộn lại', () => {
    const r = run([task('A', 1, { constraintType: 'SNET', constraintDate: d('2026-05-07') })]);
    expect(r.get('A')).toMatchObject({ es: '2026-05-07' });
  });

  it('MSO ép cứng ngày bắt đầu', () => {
    const r = run([task('A', 2, { constraintType: 'MSO', constraintDate: d('2026-05-06') })]);
    expect(r.get('A')).toMatchObject({ es: '2026-05-06', ef: '2026-05-07' });
  });

  it('FNLT KHÔNG đẩy lịch ngược, chỉ để kiểm tra (§6.6)', () => {
    const r = run([task('A', 2, { constraintType: 'FNLT', constraintDate: d('2026-05-04') })]);
    // Khong bi keo som lai — van bat dau tu project start
    expect(r.get('A')).toMatchObject({ es: '2026-05-04' });
  });
});

describe('runCpm — tính tái lập (M2)', () => {
  it('chạy 2 lần ra kết quả giống hệt, thứ tự cạnh không ảnh hưởng', () => {
    const tasks = [task('A', 2), task('B', 1), task('C', 3)];
    const edges: DepEdge[] = [
      { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
      { predUid: 'A', succUid: 'C', type: 'FS', lagDays: 0 },
      { predUid: 'B', succUid: 'C', type: 'SS', lagDays: 1 },
    ];
    const a = JSON.stringify([...run(tasks, edges).entries()].sort());
    const b = JSON.stringify([...run(tasks, [...edges].reverse()).entries()].sort());
    expect(a).toBe(b);
  });

  it('vòng lặp thì ném lỗi, không tính ra lịch vô nghĩa', () => {
    expect(() =>
      run(
        [task('A', 1), task('B', 1)],
        [
          { predUid: 'A', succUid: 'B', type: 'FS', lagDays: 0 },
          { predUid: 'B', succUid: 'A', type: 'FS', lagDays: 0 },
        ],
      ),
    ).toThrow(/cycle/i);
  });
});
