import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Test của `server` import `@planix/core` phải chạy trên SOURCE, không phải `dist`.
 *
 * Trỏ vào `dist` nghĩa là phải build trước mỗi lần chạy test, và khi quên thì test
 * lặng lẽ kiểm một bản cũ — kiểu sai tệ nhất vì nó vẫn xanh.
 */
const coreSrc = fileURLToPath(new URL('./packages/core/src', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
          // Golden test so sánh byte-for-byte và fixture 6.000 task cần thời gian.
          testTimeout: 60_000,
        },
      },
      {
        resolve: {
          alias: [{ find: /^@planix\/core\/(.*)$/, replacement: `${coreSrc}/$1` }],
        },
        test: {
          name: 'server',
          root: './packages/server',
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        // `model/` là hàm thuần, chạy trên `node` cũng được. Nhưng component thì cần DOM,
        // và chia làm hai project chỉ để tiết kiệm vài trăm mili-giây khởi động sẽ khiến
        // mỗi lần thêm test phải nhớ đặt nó vào đúng chỗ nào.
        plugins: [react()],
        test: {
          name: 'web',
          root: './packages/web',
          environment: 'jsdom',
          include: [
            'tests/**/*.test.ts',
            'tests/**/*.test.tsx',
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
          ],
          // Dọn DOM giữa các test. Thiếu nó thì test sau nhìn thấy cây của test trước, và
          // `getByRole` trả về phần tử của một màn hình đã đóng.
          globals: true,
          setupFiles: ['./tests/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Engine là phần phải đúng tuyệt đối (M2). Ngưỡng áp lên domain layer,
      // không áp lên adapter I/O — đo chỗ đó bằng golden test thì thật hơn.
      include: [
        'packages/core/src/domain/**',
        'packages/server/src/**',
        'packages/web/src/model/**',
        'packages/web/src/components/**',
      ],
      // Hai file này là khởi động tiến trình và công cụ dev, không chứa nhánh nghiệp vụ:
      // `index.ts` đọc env rồi gọi `createApp` (đã có 18 test qua HTTP thật), `dev-seed.ts`
      // chỉ dựng dữ liệu mẫu. Đo chúng không nói lên điều gì về engine, mà lại kéo ngưỡng
      // xuống sát 80% khiến CI đỏ vì lý do không liên quan.
      exclude: ['packages/server/src/index.ts', 'packages/server/src/dev-seed.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
