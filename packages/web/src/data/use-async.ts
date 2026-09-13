import { useEffect, useState } from 'react';
import { toFriendlyError, type FriendlyError } from './client.js';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: FriendlyError };

/**
 * Nạp dữ liệu bất đồng bộ với ba trạng thái tường minh.
 *
 * Không gộp "đang tải" vào "rỗng": bảng trống vì chưa tải xong và bảng trống vì dự án
 * không có task là hai chuyện khác nhau, và người dùng cần phân biệt được.
 *
 * TanStack Query sẽ thay chỗ này khi có nhiều màn cần cache chung; hiện một hook nhỏ là
 * đủ và không phải kéo thêm một lớp trạng thái vào lúc chưa cần.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    load()
      .then((data) => {
        // Bỏ kết quả nếu effect đã bị huỷ: đổi dự án nhanh sẽ khiến phản hồi cũ về sau
        // phản hồi mới và ghi đè lên nó.
        if (alive) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (alive) setState({ status: 'error', error: toFriendlyError(error) });
      });
    return () => {
      alive = false;
    };
    // `deps` do người gọi truyền vào nên phải trải thẳng vào đây; đó là chủ ý, không
    // phải thiếu sót. (Chưa cài plugin react-hooks nên không có rule nào để tắt.)
  }, deps);

  return state;
}
