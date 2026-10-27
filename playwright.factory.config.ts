import base from './playwright.config';
export default {
  ...base,
  testMatch: ['**/factory.spec.ts', '**/factory-links.spec.ts'],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4497', proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;127.0.0.1:4497' } },
  webServer: { command: 'npm start -- --host 127.0.0.1 --port 4497', url: 'http://127.0.0.1:4497', reuseExistingServer: false, timeout: 120000 }
};
