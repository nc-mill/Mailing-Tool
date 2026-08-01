import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['ci/test/**/*.test.ts'] },
});
