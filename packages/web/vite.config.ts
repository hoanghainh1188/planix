import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Dev chạy hai tiến trình; production chỉ một (§13.1 — server phục vụ cả UI tĩnh).
    // Proxy giữ cho web luôn gọi đường dẫn tương đối, nên không có nhánh code riêng cho
    // dev và không bao giờ cần cấu hình CORS.
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
