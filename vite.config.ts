import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Wireframe: pure static SPA, no backend. See trinocular_claude_plan.md §Phase 0.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
});
