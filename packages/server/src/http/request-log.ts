/**
 * Nhật ký request — một dòng JSON cho mỗi lượt gọi.
 *
 * Vì sao có file này: khi dữ liệu demo bị một lệnh `replace-subtree` xoá mất 20 task, việc
 * truy nguyên phải dựa vào `created_at` của task và `audit_log`, vì **server không ghi lại
 * gì cả** ngoài đúng một dòng lúc khởi động. Không biết được request nào đã gọi, lúc nào,
 * bởi ai. `audit_log` (§4.2) trả lời "dữ liệu đã đổi thế nào" — nó không trả lời "ai gọi
 * cái gì", và hai câu đó khác nhau.
 *
 * Ghi ra stdout: §13.1 chạy một tiến trình Node trong container, nên stdout là chỗ Docker
 * đã thu sẵn. Không tự xoay file, không tự nén — đó là việc của lớp bên ngoài.
 */

/** Những gì được phép ghi. Cố ý hẹp — xem `redactPath`. */
export interface RequestLogEntry {
  readonly at: string;
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ms: number;
  /** `null` khi chưa đăng nhập. */
  readonly userId: string | null;
}

export type LogSink = (entry: RequestLogEntry) => void;

/**
 * Bỏ query string, giữ lại đường dẫn.
 *
 * tRPC nhét input của mọi truy vấn GET vào query string: tên task, mã dự án, đôi khi cả
 * nội dung PM vừa gõ. Ghi nguyên query là biến nhật ký vận hành thành một bản sao dữ liệu
 * dự án — thứ không ai kiểm soát vòng đời, và §13 không cho phép.
 *
 * Phần còn lại vẫn đủ dùng: với tRPC, tên procedure nằm NGAY trong đường dẫn
 * (`/trpc/wbs.deleteSubtree`), tức là đúng thứ cần khi đi tìm "ai đã gọi cái gì".
 */
export function redactPath(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Ghi ra stdout, một dòng JSON. */
export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

/** Không ghi gì — dùng cho test và cho `smoke`, nơi nhật ký chỉ là tiếng ồn. */
export const silentSink: LogSink = () => {
  // có chủ đích: không làm gì
};

/**
 * Chọn nơi ghi theo biến môi trường.
 *
 * Mặc định là GHI. Một nhật ký chỉ bật khi nhớ bật thì đúng lúc cần điều tra sẽ tắt —
 * đó chính là tình huống đã xảy ra.
 */
export function sinkFromEnv(value: string | undefined): LogSink {
  return value === 'none' ? silentSink : stdoutSink;
}
