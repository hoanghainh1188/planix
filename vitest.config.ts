import { defineConfig } from 'vitest/config';

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
      // Thêm project 'server' khi bắt đầu P7, 'web' khi bắt đầu P8 (SPEC.md §14.1).
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Engine là phần phải đúng tuyệt đối (M2). Ngưỡng áp lên domain layer,
      // không áp lên adapter I/O — đo chỗ đó bằng golden test thì thật hơn.
      include: ['packages/core/src/domain/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
