import { defineConfig, devices } from '@playwright/test';

/** This suite serves a fresh local UI; its fixtures refuse all external traffic. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'program-transfer.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4495',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4495',
    url: 'http://127.0.0.1:4495',
    reuseExistingServer: false,
    timeout: 90_000
  }
});
