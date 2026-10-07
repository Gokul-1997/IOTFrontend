import base from './playwright.config';
export default { ...base, use: { ...base.use, proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>;localhost:4400' } } };
