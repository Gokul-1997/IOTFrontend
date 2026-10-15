import { defineConfig, devices } from '@playwright/test';

/** Account and alarm settings fixtures intercept every API/socket request. */
export default defineConfig({
  testDir: './e2e', testMatch: ['alarm-notification-settings.spec.ts', 'header-settings.spec.ts', 'account-pages.spec.ts', 'role-landing.spec.ts', 'notification-count.spec.ts'],
  workers: 1, timeout: 30_000, expect: { timeout: 5_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4498',
    proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;127.0.0.1:4498' },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4498',
    url: 'http://127.0.0.1:4498', reuseExistingServer: false, timeout: 60_000
  }
});
