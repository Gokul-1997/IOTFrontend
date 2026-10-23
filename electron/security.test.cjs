const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { appUrl, appFile, externalUrl } = require('./security');

const root = path.resolve('/private/tmp/iot-desktop-site');
test('bundled assets and Angular routes remain inside the website', () => {
  assert.equal(appFile(root, 'app://localhost/'), path.join(root, 'index.html'));
  assert.equal(appFile(root, 'app://localhost/chunk-123.js'), path.join(root, 'chunk-123.js'));
  assert.equal(appFile(root, 'app://localhost/reports?tab=production'), path.join(root, 'reports'));
});
test('encoded traversal, invalid paths and foreign hosts cannot read local files', () => {
  for (const value of ['app://localhost/..%2f..%2fsecret', 'app://localhost/%5c..%5csecret',
    'app://localhost/%00secret', 'app://localhost/%XX', 'app://elsewhere/index.html',
    'app://user@localhost/index.html', 'file:///etc/passwd', 'app://localhost/C:/secret']) {
    assert.equal(appFile(root, value), null, value);
  }
});
test('only the app origin can navigate in the desktop window', () => {
  assert.ok(appUrl('app://localhost/reports'));
  for (const value of ['https://example.test', 'app://localhost.evil/', 'app://localhost:8080/', 'javascript:alert(1)']) {
    assert.equal(appUrl(value), null, value);
  }
});
test('external links permit web URLs without launching local or executable protocols', () => {
  assert.equal(externalUrl('https://example.test/help'), 'https://example.test/help');
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test',
    'httpx://example.test', 'https://user:password@example.test', 'app://localhost/']) {
    assert.equal(externalUrl(value), null, value);
  }
});
