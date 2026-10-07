import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3317', browserName: 'chromium', trace: 'retain-on-failure', actionTimeout: 15_000 },
  webServer: { command: 'npm run test:serve', url: 'http://127.0.0.1:3317/api/health', reuseExistingServer: false, timeout: 90_000 },
});
