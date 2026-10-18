/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (used for hosted previews).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: { chunkSizeWarningLimit: 2000, outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
}));
