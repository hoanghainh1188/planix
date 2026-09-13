/**
 * Nền chung cho ba bản báo cáo — SPEC.md §11.
 *
 * §11.5 đòi **tái lập được**: "cùng DB + cùng `status_date` → cùng file Excel, kể cả thứ
 * tự dòng". Một file .xlsx là một file zip, và cả metadata workbook lẫn dấu thời gian
 * trong zip đều mặc định lấy đồng hồ hệ thống — nên phải ghim hết. Không ghim thì hai
 * lần xuất cách nhau một giây đã ra hai file khác nhau, và checklist P10 không bao giờ
 * tick được.
 */

import ExcelJS from 'exceljs';

/** Ngày cố định cho mọi metadata. Không dùng `new Date()` ở bất kỳ đâu trong §11. */
const EPOCH = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

export function createWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'planix';
  wb.lastModifiedBy = 'planix';
  wb.created = EPOCH;
  wb.modified = EPOCH;
  // `lastPrinted` cũng vào file; bỏ trống thì exceljs điền giờ hiện tại.
  wb.lastPrinted = EPOCH;
  return wb;
}

/**
 * Dấu thời gian DOS cho 2000-01-01 00:00:00.
 *
 * ZIP lưu ngày giờ theo định dạng MS-DOS, độ phân giải 2 giây:
 *   date = ((năm − 1980) << 9) | (tháng << 5) | ngày
 *   time = (giờ << 11) | (phút << 5) | (giây / 2)
 */
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * Ghi đè dấu thời gian của MỌI mục trong file zip.
 *
 * Vì sao cần: ExcelJS gọi `zip.append(data, {name})` mà KHÔNG truyền `date`, nên lớp zip
 * lấy `new Date()` cho từng mục. Hai lần xuất cách nhau vài giây ra hai file khác nhau ở
 * đúng bốn byte đó — và §11.5 đòi "cùng DB + cùng status_date → cùng file".
 *
 * Đi theo CẤU TRÚC zip chứ không quét chữ ký: chuỗi `PK\x03\x04` hoàn toàn có thể xuất
 * hiện ngẫu nhiên bên trong dữ liệu đã nén, và ghi đè nhầm chỗ đó sẽ làm hỏng file.
 * Đường đi đúng là: EOCD → central directory → từng local header.
 */
function pinZipTimestamps(buf: Buffer): Buffer {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  // EOCD nằm ở cuối, sau nó chỉ còn phần comment (tối đa 65535 byte).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return buf; // không phải zip hợp lệ: trả nguyên, đừng phá

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) break;

    buf.writeUInt16LE(DOS_TIME, pos + 12);
    buf.writeUInt16LE(DOS_DATE, pos + 14);

    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);

    if (localOffset + 14 <= buf.length && buf.readUInt32LE(localOffset) === LOC_SIG) {
      buf.writeUInt16LE(DOS_TIME, localOffset + 10);
      buf.writeUInt16LE(DOS_DATE, localOffset + 12);
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return buf;
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return pinZipTimestamps(Buffer.from(data));
}

/** Dùng cho test: dấu thời gian đã ghim phải đúng bằng hằng số này. */
export const PINNED_DOS = { date: DOS_DATE, time: DOS_TIME } as const;

/** Dịch trạng thái sang tiếng Nhật cho bản `summary` (§11.3). */
export function statusJa(status: string): string {
  switch (status) {
    case 'not_started':
      return '未着手';
    case 'in_progress':
      return '進行中';
    case 'done':
      return '完了';
    case 'blocked':
      return '保留';
    case 'cancelled':
      return '中止';
    default:
      return status;
  }
}

/** Thụt lề tên task theo cấp — §11.2 cột B. */
export function indent(name: string, depth: number): string {
  return `${'    '.repeat(Math.max(0, depth - 1))}${name}`;
}
