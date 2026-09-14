/**
 * Dọn DOM sau mỗi test.
 *
 * Thiếu bước này thì test sau nhìn thấy cây của test trước, và `getByRole` trả về phần tử
 * của một màn hình đã đóng — kiểu hỏng tệ nhất vì nó thường vẫn XANH, chỉ sai khi thứ tự
 * test đổi.
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
