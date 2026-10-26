import base from './playwright.config';
export default {
  ...base,
  testMatch: '**/preventive-presentation.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4498', proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;127.0.0.1:4498' } },
  webServer: { command: 'npm start -- --host 127.0.0.1 --port 4498', url: 'http://127.0.0.1:4498', reuseExistingServer: false, timeout: 120000 }
};
