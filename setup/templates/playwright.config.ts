import { defineConfig } from '@playwright/test';

const port = Number(process.env.STACK_TEST_PORT || 4317);

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium' },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
