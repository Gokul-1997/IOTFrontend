import type { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

const localOrigin = 'http://127.0.0.1:4495';
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const response = (data: unknown, status = 200) => ({ status, json: { status: 'success', data } });
const file = (machine: number, id: number, name: string, kind = 'NEW', current = false) => ({
  id, machine_id: machine, machine_serial_no: `VMC-${machine - 6}`, folder: `company-4/machine-${machine}`,
  stored_name: `${id}_${kind}_${name}`, program_name: name, kind, size_bytes: 2048,
  sha256: 'a'.repeat(64), note: null, job_id: null, created_at: ago(60), uploaded_by_name: 'Operator', is_current: current
});
type FileRow = ReturnType<typeof file>;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function fixtures(page: Page) {
  const state = {
    machines: [7, 8].map((id, index) => ({ id, machine_serial_no: `VMC-${index + 1}`, ip_address: null,
      program_path: null, folder: `company-4/machine-${id}`, device_id: index === 0 ? 3 : null,
      device_label: 'CNC device', token_prefix: 'mxd_example', device_created_at: ago(86400),
      last_seen_at: ago(5), last_seen_ip: '192.0.2.10', agent_version: null, online: index === 0,
      open_jobs: 0, controller_reported_at: null })),
    current: { 7: file(7, 40, 'O1234.nc', 'NEW', true), 8: file(8, 50, 'O8000.nc', 'NEW', true) } as Record<number, FileRow | null>,
    backups: { 7: [file(7, 60, 'O2001.nc', 'BACKUP')], 8: [] } as Record<number, FileRow[]>,
    files: { 7: [file(7, 40, 'O1234.nc', 'NEW', true), file(7, 39, 'O1000.nc')], 8: [file(8, 50, 'O8000.nc', 'NEW', true)] } as Record<number, FileRow[]>,
    requests: [] as { method: string; path: string }[], downloads: [] as number[]
  };
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return url.origin === localOrigin ? route.continue() : route.abort();
    state.requests.push({ method: request.method(), path });
    if (path === '/api/auth/refresh') {
      // Fake clocks clamp the shared year-long seed's refresh timer. Return a realistic local token.
      const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.e2e`;
      return route.fulfill({ json: { accessToken: jwt, refreshToken: jwt } });
    }
    if (path === '/api/programs/machines') return route.fulfill(response(state.machines));
    const current = path.match(/^\/api\/programs\/machines\/(\d+)\/current-program$/);
    if (current && request.method() === 'GET') return route.fulfill(response({ file: state.current[Number(current[1])] || null }));
    if (path === '/api/programs/files' && request.method() === 'GET') {
      const id = Number(url.searchParams.get('machine_id'));
      const data = url.searchParams.get('kind') === 'BACKUP' ? state.backups[id] : state.files[id];
      return route.fulfill({ json: { data: data || [], total: data?.length || 0 } });
    }
    const download = path.match(/^\/api\/programs\/files\/(\d+)\/download$/);
    if (download) {
      state.downloads.push(Number(download[1]));
      return route.fulfill({ contentType: 'application/octet-stream', body: '%\nO2001\nM30\n%\n' });
    }
    return route.fulfill(response([]));
  });
  return state;
}
const currentCard = (page: Page) => page.getByRole('region', { name: 'Current program', exact: true });
const choose = (page: Page, machine: string) => page.getByLabel('CNC Machine').selectOption({ label: machine });
async function openUpload(page: Page) {
  await page.getByRole('button', { name: 'Upload program', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload program', exact: true });
  await dialog.getByLabel(/G-code file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  return dialog;
}

test('upload publishes one current file directly with no job request or send checkbox', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  let body = '';
  await page.route('**/api/programs/machines/7/current-program', route => {
    if (route.request().method() === 'GET') return route.fallback();
    body = route.request().postData() || '';
    state.current[7] = file(7, 61, 'O3000.nc', 'NEW', true);
    return route.fulfill(response({ file: state.current[7] }, 201));
  });
  await page.goto('/programs');
  const dialog = await openUpload(page);
  await expect(dialog).toContainText('VMC-1');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(currentCard(page)).toContainText('O3000.nc');
  await expect(currentCard(page)).toContainText('Ready for machine download');
  expect(body).toContain('filename="O3000.nc"');
  expect(body).not.toContain('name="send"');
  expect(state.requests.filter(r => /jobs|controller-files/.test(r.path))).toEqual([]);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await page.getByText('API guide', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download API guide', exact: true })).toHaveAttribute('href', '/integrations/PROGRAM_TRANSFER_DEVICE_API.md');
  await expect(page.locator('a[href*="postman"], a[href*="PROGRAM_TRANSFER_QUICKSTART"]')).toHaveCount(0);
});

test('publishing works before a device token or controller path is configured', async ({ authedPage: page }) => {
  await fixtures(page);
  let calls = 0;
  await page.route('**/api/programs/machines/8/current-program', route => {
    if (route.request().method() === 'GET') return route.fallback();
    calls++;
    return route.fulfill(response({ file: file(8, 62, 'O3000.nc', 'NEW', true) }, 201));
  });
  await page.goto('/programs');
  await choose(page, 'VMC-2');
  const dialog = await openUpload(page);
  await expect(dialog).toContainText('VMC-2');
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(currentCard(page)).toContainText('O3000.nc');
  expect(calls).toBe(1);
});

test('Backup downloads the latest machine backup without changing the current program', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.goto('/programs');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('O2001.nc');
  expect(state.downloads).toEqual([60]);
  await expect(currentCard(page)).toContainText('O1234.nc');
  expect(state.requests.filter(r => r.method === 'POST' && r.path.startsWith('/api/programs'))).toEqual([]);
});

test('no publication and no backup are shown honestly, without manufacturing a current file from history', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.current[7] = null; state.backups[7] = [];
  await page.goto('/programs');
  await expect(currentCard(page)).toContainText('No current program');
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeDisabled();
  await page.getByText('Previous files and backups', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved files and backups' })).toContainText('O1000.nc');
});

test('a pending upload locks the form and cannot submit twice', async ({ authedPage: page }) => {
  await fixtures(page);
  const pending = gate(); let posts = 0;
  await page.route('**/api/programs/machines/7/current-program', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    posts++; await pending.promise;
    return route.fulfill(response({ file: file(7, 61, 'O3000.nc', 'NEW', true) }, 201));
  });
  await page.goto('/programs');
  const dialog = await openUpload(page);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByLabel(/G-code file/)).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close upload' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Uploading…', exact: true }).dispatchEvent('click');
  pending.release();
  await expect(dialog).toHaveCount(0);
  expect(posts).toBe(1);
});

test('upload failure leaves the previous current program and shows the error in the dialog', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.route('**/api/programs/machines/7/current-program', route => route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 422, json: { message: 'The file is not a text NC program.' } }));
  await page.goto('/programs');
  const dialog = await openUpload(page);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('not a text NC program');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(currentCard(page)).toContainText('O1234.nc');
});

test('failed current-program lookup is not presented as an empty machine', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.route('**/api/programs/machines/7/current-program', route => route.fulfill({ status: 500, json: { message: 'Current program is temporarily unavailable.' } }));
  await page.goto('/programs');
  await expect(currentCard(page).getByRole('alert')).toContainText('temporarily unavailable');
  await expect(currentCard(page)).not.toContainText('No current program');
});

test('switching machines discards old current, backup and file responses', async ({ authedPage: page }) => {
  await fixtures(page);
  const pending = gate(); let waiting = 0;
  await page.route('**/api/programs/machines/7/current-program', async route => {
    waiting++; await pending.promise; await route.fulfill(response({ file: file(7, 40, 'OLD.nc') })).catch(() => {});
  });
  await page.route('**/api/programs/files?*', async route => {
    if (new URL(route.request().url()).searchParams.get('machine_id') !== '7') return route.fallback();
    waiting++; await pending.promise; await route.fulfill({ json: { data: [file(7, 99, 'OLD.nc')], total: 1 } }).catch(() => {});
  });
  await page.goto('/programs');
  await expect.poll(() => waiting).toBe(3);
  await choose(page, 'VMC-2');
  await expect(currentCard(page)).toContainText('O8000.nc');
  pending.release();
  await page.getByText('Previous files and backups', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved files and backups' })).toContainText('O8000.nc');
  await expect(page.getByText('OLD.nc', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeDisabled();
});

test('visible polling updates current program and backup without any job or socket', async ({ authedPage: page }) => {
  await page.clock.install();
  const state = await fixtures(page);
  await page.goto('/programs');
  await expect(currentCard(page)).toContainText('O1234.nc');
  state.current[7] = file(7, 70, 'NEW.nc', 'NEW', true);
  state.backups[7] = [file(7, 71, 'MACHINE.nc', 'BACKUP')];
  await page.clock.runFor(10_100);
  await expect(currentCard(page)).toContainText('NEW.nc');
  await expect(page.getByRole('region', { name: 'Machine backup', exact: true })).toContainText('MACHINE.nc');
  expect(state.requests.filter(r => r.path.includes('/jobs'))).toEqual([]);
});

for (const role of ['read-only', 'upload-only']) {
  test(`${role} permissions cannot publish or change machine credentials`, async ({ page }) => {
    const permissions = ['page:programs:view', 'machine.view', ...(role === 'upload-only' ? ['page:programs:upload'] : [])];
    await seedAuth(page, { roles: ['SETTER'], permissions, company_permissions: permissions });
    await fixtures(page); await page.goto('/programs');
    await expect(currentCard(page)).toContainText('O1234.nc');
    await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toHaveCount(0);
    await page.getByText('Machine connection', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Device token', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  });
}

test('current file cannot be deleted, and creating a device token requires no program path', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  let body: unknown;
  await page.route('**/api/programs/machines/8/device-token', route => {
    body = route.request().postDataJSON();
    return route.fulfill(response({ token: 'mxd_' + 'x'.repeat(43), device: {} }, 201));
  });
  await page.goto('/programs');
  await page.getByText('Previous files and backups', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete 40_NEW_O1234.nc', exact: true })).toHaveCount(0);
  await choose(page, 'VMC-2');
  await page.getByText('Machine connection', { exact: true }).click();
  await page.getByRole('button', { name: 'Create device token', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Device at VMC-2' });
  await expect(dialog.getByLabel(/Program path/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create token', exact: true }).click();
  await expect(dialog.getByLabel('Device configuration')).toContainText('mxd_' + 'x'.repeat(43));
  expect(body).toEqual({ label: 'CNC device' });
  expect(state.requests.some(r => r.method === 'PUT')).toBe(false);
});

test('replacing a device token asks explicitly before invalidating the old token', async ({ authedPage: page }) => {
  await fixtures(page); let calls = 0;
  await page.route('**/api/programs/machines/7/device-token', route => {
    calls++; return route.fulfill(response({ token: 'mxd_' + 'x'.repeat(43), device: {} }, 201));
  });
  await page.goto('/programs');
  await page.getByText('Machine connection', { exact: true }).click();
  await page.getByRole('button', { name: 'Device token', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Device at VMC-1' });
  await dialog.getByRole('button', { name: 'New token', exact: true }).click();
  expect(calls).toBe(0);
  await dialog.getByRole('button', { name: 'Yes, replace it', exact: true }).click();
  await expect(dialog.getByLabel('Device configuration')).toBeVisible();
  expect(calls).toBe(1);
});

test('the compact screen and upload dialog fit phones, tablets and desktop', async ({ authedPage: page }, testInfo) => {
  await fixtures(page); await page.goto('/programs');
  await expect(currentCard(page)).toContainText('O1234.nc');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`programs-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openUpload(page);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
