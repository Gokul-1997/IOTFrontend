import base from './playwright.config';
export default {
  ...base,
  testMatch: ['**/energy-integrity.spec.ts', '**/energy-bars.spec.ts', '**/energy-meter.spec.ts'],
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4496', proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;127.0.0.1:4496' } },
  webServer: { command: 'npm start -- --host 127.0.0.1 --port 4496', url: 'http://127.0.0.1:4496', reuseExistingServer: false, timeout: 120000 }
};
