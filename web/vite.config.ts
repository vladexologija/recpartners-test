/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApi } from './mock/mockApi.ts';

// `pnpm dev:mock` swaps the Python API and GCS for an in-memory stand-in (mock/mockApi.ts).
const useMockApi = process.env.MOCK_API === '1';

export default defineConfig({
  plugins: [react(), ...(useMockApi ? [mockApi()] : [])],
  // Without the mock, API calls go to the local FastAPI server.
  server: useMockApi ? {} : { proxy: { '/api': 'http://localhost:8000' } },
  test: {
    coverage: {
      include: ['src/**'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
  },
});
