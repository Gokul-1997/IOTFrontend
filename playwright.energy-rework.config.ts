import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: ['energy-integrity.spec.ts', 'energy-meter.spec.ts', 'energy-bars.spec.ts'],
  workers: 2, timeout: 45000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4498', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4498',
    url: 'http://127.0.0.1:4498', reuseExistingServer: false, timeout: 60000,
    env: { NG_BUILD_MAX_WORKERS: '2' } }
});
