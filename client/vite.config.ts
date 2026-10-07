import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { host: '0.0.0.0', proxy: { '/api': 'http://localhost:3000' } },
});
