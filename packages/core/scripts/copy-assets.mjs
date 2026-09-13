/**
 * Chép mọi file KHÔNG phải TypeScript từ `src/` sang `dist/`.
 *
 * `tsc` chỉ dịch `.ts`. Migration `.sql` và seed lễ `.json` nằm cạnh code, được đọc bằng
 * đường dẫn tương đối so với vị trí file, nên thiếu chúng thì chỉ bản build mới hỏng —
 * test vẫn xanh vì vitest chạy thẳng trên `src/`.
 *
 * Trước đây đây là một dòng `cp -R src/db/migrations`. P2 thêm `db/seed/holidays` mà
 * không ai sửa dòng đó, nên bản build lặng lẽ thiếu dữ liệu. Chép theo quy tắc "mọi thứ
 * không phải .ts" để thư mục dữ liệu mới không làm hỏng lại lần nữa.
 */

import { cpSync } from 'node:fs';
import { join } from 'node:path';

// `import.meta.dirname` có từ Node 20.11; SPEC §3.1 đã chốt Node 22 nên dùng được.
const pkg = join(import.meta.dirname, '..');

cpSync(join(pkg, 'src'), join(pkg, 'dist'), {
  recursive: true,
  filter: (path) => !path.endsWith('.ts'),
});
