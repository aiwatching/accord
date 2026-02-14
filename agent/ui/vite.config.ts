import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  root: path.resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Avoid eval/new Function in production — prevents CSP violations
    minify: 'esbuild',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
