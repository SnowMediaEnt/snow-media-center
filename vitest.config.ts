import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Edge functions import Deno-style npm: specifiers. Mapped so a test
      // can load a function file (and vi.mock '@supabase/supabase-js').
      { find: /^npm:@supabase\/supabase-js@2\/cors$/, replacement: path.resolve(__dirname, './src/test/edge/cors.ts') },
      { find: /^npm:@supabase\/supabase-js@2$/, replacement: '@supabase/supabase-js' },
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js@[\d.]+$/, replacement: '@supabase/supabase-js' },
      { find: /^npm:resend@[\d.]+$/, replacement: path.resolve(__dirname, './src/test/edge/resend.ts') },
      { find: /^https:\/\/deno\.land\/std@[\d.]+\/http\/server\.ts$/, replacement: path.resolve(__dirname, './src/test/edge/denoStdServer.ts') },
      { find: /^https:\/\/deno\.land\/std@[\d.]+\/encoding\/base64\.ts$/, replacement: path.resolve(__dirname, './src/test/edge/denoStdBase64.ts') },
      { find: /^https:\/\/deno\.land\/x\/xhr@[\d.]+\/mod\.ts$/, replacement: path.resolve(__dirname, './src/test/edge/empty.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
