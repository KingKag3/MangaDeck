import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to your Suwayomi server so the browser stays same-origin
// (no CORS, cookies and basic auth keep working). Set SUWAYOMI_URL in .env.local to change it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.SUWAYOMI_URL || 'http://localhost:4567';
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
  };
});
