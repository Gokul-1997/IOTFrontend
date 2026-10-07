import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'fleet-pagination.spec.ts', workers: 1,
  timeout: 30000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4493', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4493',
    url: 'http://127.0.0.1:4493', reuseExistingServer: false, timeout: 60000
  }
});
