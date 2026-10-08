import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        // Keep the browser-facing host so FastAPI's Origin check also works in dev.
        changeOrigin: false,
      },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { livekit: ['livekit-client'] } } } },
});
