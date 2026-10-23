const path = require('path');

function appUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === 'localhost' &&
      !url.port && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Protocol requests may contain encoded separators. Resolve only after decoding
// and check containment so a request can never read beyond the bundled website.
function appFile(root, value) {
  const url = appUrl(value);
  if (!url) return null;
  let name;
  try { name = decodeURIComponent(url.pathname); } catch { return null; }
  if (/[\0\\:]/.test(name)) return null;
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) ? file : null;
}

module.exports = { appUrl, externalUrl, appFile };
