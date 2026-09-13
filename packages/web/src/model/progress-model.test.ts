import { describe, expect, it } from 'vitest';
import {
  acceptAllSuggestions,
  applyStatusKey,
  attentionCount,
  buildDraft,
  changedRows,
  fillDown,
  groupMicroByParent,
  markSubtreeDone,
  setStatus,
  visibleRows,
  type BoardRow,
  type Draft,
} from './progress-model.js';

const STATUS_DATE = '2026-03-10';

function r(over: Partial<BoardRow> = {}): BoardRow {
  return {
    uid: 'u1',
    wbsCode: '1.1',
    name: 'Task',
    parentUid: 'p1',
    parentName: 'Module',
    effortMd: 2,
    pic: 'Dev A',
    teamId: 'TM',
    isMicro: false,
    planStart: '2026-03-02',
    planEnd: '2026-03-06',
    saved: null,
    // Trung tính: để mỗi test tự nêu đề xuất nó quan tâm, thay vì thừa hưởng 'done'.
    suggestion: { status: 'not_started', percent: 0, actualStart: null, actualEnd: null },
    onTrack: false,
    ...over,
  };
}

describe('mở màn: đề xuất điền sẵn, ở dạng CHƯA lưu (§10.5)', () => {
  it('dòng chưa nhập lấy giá trị đề xuất và được đánh dấu là đề xuất', () => {
    const d = buildDraft([
      r({
        suggestion: {
          status: 'done',
          percent: 100,
          actualStart: '2026-03-02',
          actualEnd: '2026-03-06',
        },
      }),
    ]);
    expect(d.get('u1')?.status).toBe('done');
    expect(d.get('u1')?.percent).toBe(100);
    expect(d.get('u1')?.isSuggestion).toBe(true);
  });

  it('dòng đã nhập giữ giá trị ĐÃ LƯU, không bị đề xuất ghi đè', () => {
    const row = r({
      saved: {
        status: 'blocked',
        percent: 30,
        actualStart: '2026-03-02',
        actualEnd: null,
        blockedNote: 'Waiting',
      },
    });
    const d = buildDraft([row]);
    expect(d.get('u1')?.status).toBe('blocked');
    expect(d.get('u1')?.blockedNote).toBe('Waiting');
    expect(d.get('u1')?.isSuggestion).toBe(false);
  });
});

describe('lọc mặc định — chỉ hiện việc CẦN xử lý (§10.5)', () => {
  const rows = [
    r({
      uid: 'done',
      saved: {
        status: 'done',
        percent: 100,
        actualStart: null,
        actualEnd: '2026-03-06',
        blockedNote: null,
      },
      onTrack: true,
    }),
    r({ uid: 'future', planStart: '2026-04-01', planEnd: '2026-04-05', onTrack: true }),
    r({ uid: 'needs', onTrack: false }),
    r({ uid: 'ontrack', onTrack: true }),
  ];

  it('ẩn task đã done', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, {}).map((v) => v.row.uid);
    expect(uids).not.toContain('done');
  });

  it('ẩn task chưa tới ngày bắt đầu', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, {}).map((v) => v.row.uid);
    expect(uids).not.toContain('future');
  });

  it('giữ task cần xử lý', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, {}).map((v) => v.row.uid);
    expect(uids).toContain('needs');
  });

  it('gom dòng on-track lại, không hiện lẻ', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, {}).map((v) => v.row.uid);
    expect(uids).not.toContain('ontrack');
  });

  it('bỏ gom thì dòng on-track hiện ra để soi lại', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, { expandOnTrack: true }).map(
      (v) => v.row.uid,
    );
    expect(uids).toContain('ontrack');
  });

  it('tắt lọc mặc định thì hiện tất, kể cả done', () => {
    const uids = visibleRows(rows, buildDraft(rows), STATUS_DATE, {
      showAll: true,
      expandOnTrack: true,
    }).map((v) => v.row.uid);
    expect(uids).toEqual(['done', 'future', 'needs', 'ontrack']);
  });

  it('sắp theo NATURAL sort: 1.1.9 đứng trước 1.1.10', () => {
    const rows = [
      r({ uid: 'b', wbsCode: '1.1.10' }),
      r({ uid: 'a', wbsCode: '1.1.9' }),
      r({ uid: 'c', wbsCode: '1.1.2' }),
    ];
    const codes = visibleRows(rows, buildDraft(rows), STATUS_DATE, {}).map((v) => v.row.wbsCode);
    expect(codes).toEqual(['1.1.2', '1.1.9', '1.1.10']);
  });

  it('mục tiêu của §10.5: 300 dòng xuống còn số ít', () => {
    const many: BoardRow[] = [];
    for (let i = 0; i < 300; i++) {
      many.push(r({ uid: `t${i}`, onTrack: i >= 25 }));
    }
    expect(visibleRows(many, buildDraft(many), STATUS_DATE, {}).length).toBe(25);
  });
});

describe('chỉ báo "Reviewed x / y" (§10.5)', () => {
  it('đếm dòng cần chú ý và dòng lead đã thật sự đụng vào', () => {
    const rows = [r({ uid: 'a' }), r({ uid: 'b' }), r({ uid: 'c', onTrack: true })];
    let d = buildDraft(rows);
    expect(attentionCount(rows, d, STATUS_DATE)).toEqual({ reviewed: 0, total: 2 });

    d = applyStatusKey(d, 'a', 'D', STATUS_DATE);
    expect(attentionCount(rows, d, STATUS_DATE)).toEqual({ reviewed: 1, total: 2 });
  });
});

describe('phím tắt (§10.5)', () => {
  it('D đặt done, điền 100% và actual_end', () => {
    const d = applyStatusKey(buildDraft([r()]), 'u1', 'D', STATUS_DATE);
    const e = d.get('u1');
    expect(e?.status).toBe('done');
    expect(e?.percent).toBe(100);
    expect(e?.actualEnd).not.toBeNull();
    expect(e?.isSuggestion).toBe(false);
  });

  it('P đặt in_progress', () => {
    const d = applyStatusKey(buildDraft([r()]), 'u1', 'P', STATUS_DATE);
    expect(d.get('u1')?.status).toBe('in_progress');
  });

  it('B đặt blocked', () => {
    const d = applyStatusKey(buildDraft([r()]), 'u1', 'B', STATUS_DATE);
    expect(d.get('u1')?.status).toBe('blocked');
  });

  it('P và B bị VÔ HIỆU trên micro task (§7.9)', () => {
    const rows = [r({ isMicro: true })];
    const base = buildDraft(rows);
    expect(applyStatusKey(base, 'u1', 'P', STATUS_DATE, rows).get('u1')?.status).not.toBe(
      'in_progress',
    );
    expect(applyStatusKey(base, 'u1', 'B', STATUS_DATE, rows).get('u1')?.status).not.toBe(
      'blocked',
    );
  });

  it('chuyển sang blocked thì XOÁ actual_end còn sót — việc chưa xong', () => {
    let d = applyStatusKey(buildDraft([r()]), 'u1', 'D', STATUS_DATE);
    expect(d.get('u1')?.actualEnd).not.toBeNull();
    d = applyStatusKey(d, 'u1', 'B', STATUS_DATE);
    expect(d.get('u1')?.actualEnd).toBeNull();
  });

  it('not_started xoá sạch actual và đưa % về 0', () => {
    let d = applyStatusKey(buildDraft([r()]), 'u1', 'D', STATUS_DATE);
    d = setStatus(d, 'u1', 'not_started', STATUS_DATE);
    expect(d.get('u1')?.actualStart).toBeNull();
    expect(d.get('u1')?.actualEnd).toBeNull();
    expect(d.get('u1')?.percent).toBe(0);
  });

  it('D vẫn chạy trên micro task', () => {
    const rows = [r({ isMicro: true })];
    const d = applyStatusKey(buildDraft(rows), 'u1', 'D', STATUS_DATE, rows);
    expect(d.get('u1')?.status).toBe('done');
    expect(d.get('u1')?.percent).toBe(100);
  });
});

describe('thao tác nhóm (§10.5)', () => {
  const rows = [r({ uid: 'a' }), r({ uid: 'b' }), r({ uid: 'c' })];

  it('fill-down chép giá trị dòng nguồn sang các dòng được chọn', () => {
    let d = buildDraft(rows);
    d = applyStatusKey(d, 'a', 'B', STATUS_DATE);
    d = fillDown(d, 'a', ['b', 'c']);
    expect(d.get('b')?.status).toBe('blocked');
    expect(d.get('c')?.status).toBe('blocked');
    expect(d.get('b')?.isSuggestion).toBe(false);
  });

  it('fill-down KHÔNG đụng dòng ngoài danh sách chọn', () => {
    let d = buildDraft([...rows, r({ uid: 'z' })]);
    d = applyStatusKey(d, 'a', 'B', STATUS_DATE);
    d = fillDown(d, 'a', ['b']);
    expect(d.get('z')?.isSuggestion).toBe(true);
  });

  it('accept all chốt mọi đề xuất còn lại', () => {
    const d = acceptAllSuggestions(buildDraft(rows));
    expect([...d.values()].every((e) => !e.isSuggestion)).toBe(true);
  });

  it('accept all KHÔNG ghi đè thứ lead đã sửa tay', () => {
    let d = buildDraft(rows);
    d = applyStatusKey(d, 'a', 'B', STATUS_DATE);
    d = acceptAllSuggestions(d);
    expect(d.get('a')?.status).toBe('blocked');
  });

  it('mark subtree done đặt done cho cả nhánh theo ngày chọn', () => {
    const tree = [r({ uid: 'x', parentUid: 'p1' }), r({ uid: 'y', parentUid: 'p1' })];
    const d = markSubtreeDone(buildDraft(tree), tree, 'p1', '2026-03-09');
    expect(d.get('x')?.status).toBe('done');
    expect(d.get('x')?.actualEnd).toBe('2026-03-09');
    expect(d.get('y')?.status).toBe('done');
  });
});

describe('micro task gom theo cụm cha (§10.5)', () => {
  it('đếm đúng "x / y done" cho từng cụm', () => {
    const rows = [
      r({ uid: 'm1', isMicro: true, parentUid: 'P', parentName: 'Payment module' }),
      r({ uid: 'm2', isMicro: true, parentUid: 'P', parentName: 'Payment module' }),
      r({ uid: 'm3', isMicro: true, parentUid: 'P', parentName: 'Payment module' }),
    ];
    let d = buildDraft(rows);
    d = applyStatusKey(d, 'm1', 'D', STATUS_DATE, rows);
    d = applyStatusKey(d, 'm2', 'D', STATUS_DATE, rows);

    const groups = groupMicroByParent(rows, d);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parentName).toBe('Payment module');
    expect(groups[0]?.done).toBe(2);
    expect(groups[0]?.total).toBe(3);
  });

  it('task thường không bị gom vào cụm micro', () => {
    const rows = [r({ uid: 'n', isMicro: false }), r({ uid: 'm', isMicro: true })];
    const groups = groupMicroByParent(rows, buildDraft(rows));
    expect(groups[0]?.total).toBe(1);
  });
});

describe('gửi đi cái gì khi lưu', () => {
  it('chỉ gửi dòng lead đã chốt, không gửi đề xuất chưa đụng tới', () => {
    const rows = [r({ uid: 'a' }), r({ uid: 'b' })];
    let d = buildDraft(rows);
    d = applyStatusKey(d, 'a', 'D', STATUS_DATE);
    expect(changedRows(d, rows).map((x) => x.taskUid)).toEqual(['a']);
  });

  it('KHÔNG gửi lại dòng đã lưu mà không đổi gì', () => {
    // Sau khi lưu, server trả về `saved` đúng bằng draft. Nút phải quay về "Save 0 rows",
    // nếu không lead không phân biệt được cái gì đã lưu và cái gì chưa.
    const rows = [
      r({
        uid: 'a',
        saved: {
          status: 'done',
          percent: 100,
          actualStart: '2026-03-02',
          actualEnd: '2026-03-06',
          blockedNote: null,
        },
      }),
    ];
    expect(changedRows(buildDraft(rows), rows)).toEqual([]);
  });

  it('dòng đã lưu nhưng lead sửa tiếp thì VẪN gửi', () => {
    const rows = [
      r({
        uid: 'a',
        saved: {
          status: 'in_progress',
          percent: 40,
          actualStart: '2026-03-02',
          actualEnd: null,
          blockedNote: null,
        },
      }),
    ];
    const d = applyStatusKey(buildDraft(rows), 'a', 'D', STATUS_DATE);
    expect(changedRows(d, rows).map((x) => x.taskUid)).toEqual(['a']);
  });

  it('dòng gửi đi mang đủ trường server cần', () => {
    const rows = [r()];
    let d: Draft = buildDraft(rows);
    d = applyStatusKey(d, 'u1', 'B', STATUS_DATE);
    const [row] = changedRows(d, rows);
    expect(row).toMatchObject({
      taskUid: 'u1',
      status: 'blocked',
    });
    expect(row).toHaveProperty('percent');
    expect(row).toHaveProperty('actualStart');
    expect(row).toHaveProperty('actualEnd');
    expect(row).toHaveProperty('blockedNote');
  });

  it('không có gì đổi thì không gửi gì', () => {
    const rows = [r()];
    expect(changedRows(buildDraft(rows), rows)).toEqual([]);
  });
});
