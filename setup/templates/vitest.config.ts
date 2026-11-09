import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // No application behavior exists yet. Add meaningful tests as it is built.
    passWithNoTests: true,
  },
});
