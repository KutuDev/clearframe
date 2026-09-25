import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // FFmpeg's runtime worker uses importScripts() to load its UMD core. Vite's
  // default ESM worker output disables importScripts and causes its generic
  // “failed to import ffmpeg-core.js” error.
  worker: { format: 'iife' },
  build: { target: 'es2022' },
});
