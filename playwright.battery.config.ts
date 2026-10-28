import base from './playwright.config';
export default {
  ...base,
  testMatch: ['**/maintenance-fans-battery.spec.ts', '**/maintenance-layout.spec.ts', '**/maintenance-polish.spec.ts'],
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4494', proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;127.0.0.1:4494' } },
  webServer: { command: 'npm start -- --host 127.0.0.1 --port 4494', url: 'http://127.0.0.1:4494', reuseExistingServer: false, timeout: 120000 }
};
