/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const dir = import.meta.dirname;

export default defineConfig({
  root: path.resolve(dir, 'src/client'),
  plugins: [react()],
  build: {
    outDir: path.resolve(dir, 'dist/client'),
    emptyOutDir: true,
  },
  test: {
    // Vite's root is the client folder; tests live alongside server code too.
    dir: path.resolve(dir, 'src'),
  },
});
