import { defineConfig, devices } from '@playwright/test';

/** Isolated fixtures: the test refuses external API/socket traffic. */
export default defineConfig({
  testDir: './e2e', testMatch: 'local-storage.spec.ts', workers: 1,
  timeout: 30_000, expect: { timeout: 5_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4496', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4496',
    url: 'http://127.0.0.1:4496', reuseExistingServer: false, timeout: 60_000
  }
});
