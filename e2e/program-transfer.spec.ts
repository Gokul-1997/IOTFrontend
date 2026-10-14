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
const job = (machine: number, id: number, action = 'SEND', status = 'QUEUED', extra = {}) => ({
  id, machine_id: machine, action, status, program_name: action === 'SEND' ? 'O3000.nc' : null,
  message: null, error_code: null, expires_at: new Date(Date.now() + 300_000).toISOString(),
  requested_at: ago(0), finished_at: null, file_id: action === 'SEND' ? 61 : null, ...extra
});
type FileRow = ReturnType<typeof file>;
type JobRow = ReturnType<typeof job>;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function fixtures(page: Page) {
  const state = {
    machines: [7, 8].map((id, index) => ({ id, machine_serial_no: `VMC-${index + 1}`, ip_address: `192.168.1.${101 + index}`,
      program_path: '//CNC_MEM/USER/PATH1/', folder: `company-4/machine-${id}`, device_id: index + 3,
      device_label: 'CNC device', token_prefix: 'mxd_example', device_created_at: ago(86400),
      last_seen_at: ago(index === 0 ? 5 : 90), last_seen_ip: '192.0.2.10', agent_version: null, online: index === 0,
      open_jobs: 0, controller_reported_at: null })),
    current: { 7: file(7, 40, 'O1234.nc', 'NEW', true), 8: file(8, 50, 'O8000.nc', 'NEW', true) } as Record<number, FileRow | null>,
    backups: { 7: file(7, 60, 'O2001.nc', 'BACKUP'), 8: null } as Record<number, FileRow | null>,
    jobs: { 7: [], 8: [] } as Record<number, JobRow[]>,
    files: { 7: [file(7, 40, 'O1234.nc', 'NEW', true), file(7, 39, 'O1000.nc')], 8: [file(8, 50, 'O8000.nc', 'NEW', true)] } as Record<number, FileRow[]>,
    requests: [] as { method: string; path: string; key?: string }[], downloads: [] as number[]
  };
  const status = (id: number) => ({ machine: state.machines.find(m => m.id === id), file: state.current[id], backup: state.backups[id], jobs: state.jobs[id] });
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return url.origin === localOrigin ? route.continue() : route.abort();
    state.requests.push({ method: request.method(), path, key: request.headers()['idempotency-key'] });
    if (path === '/api/auth/refresh') {
      const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.e2e`;
      return route.fulfill({ json: { accessToken: jwt, refreshToken: jwt } });
    }
    if (path === '/api/programs/machines') return route.fulfill(response(state.machines));
    const current = path.match(/^\/api\/programs\/machines\/(\d+)\/status$/);
    if (current) return route.fulfill(response(status(Number(current[1]))));
    const connection = path.match(/^\/api\/programs\/machines\/(\d+)\/connection$/);
    if (connection) {
      const machine = state.machines.find(m => m.id === Number(connection[1]))!;
      Object.assign(machine, request.postDataJSON()); return route.fulfill(response({ machine }));
    }
    const transfer = path.match(/^\/api\/programs\/machines\/(\d+)\/transfer$/);
    if (transfer) {
      const id = Number(transfer[1]); state.current[id] = file(id, 61, 'O3000.nc', 'NEW', true); state.jobs[id] = [job(id, 90)];
      return route.fulfill(response({ file: state.current[id], job: state.jobs[id][0] }, 201));
    }
    const backup = path.match(/^\/api\/programs\/machines\/(\d+)\/backup$/);
    if (backup) {
      const id = Number(backup[1]); const next = job(id, 91 + state.requests.filter(r => r.path === path).length, 'BACKUP'); state.jobs[id] = [next];
      return route.fulfill(response({ job: next }, 201));
    }
    if (path === '/api/programs/files' && request.method() === 'GET') {
      const data = state.files[Number(url.searchParams.get('machine_id'))];
      return route.fulfill({ json: { data: data || [], total: data?.length || 0 } });
    }
    const download = path.match(/^\/api\/programs\/files\/(\d+)\/download$/);
    if (download) { state.downloads.push(Number(download[1])); return route.fulfill({ contentType: 'application/octet-stream', body: '%\nO2001\nM30\n%\n' }); }
    return route.fulfill(response([]));
  });
  return state;
}
const currentCard = (page: Page) => page.getByRole('region', { name: 'Latest uploaded program', exact: true });
const backupCard = (page: Page) => page.getByRole('region', { name: 'Current running program backup', exact: true });
const choose = (page: Page, machine: string) => page.getByLabel('CNC Machine').selectOption({ label: machine });
async function openUpload(page: Page) {
  await page.getByRole('button', { name: 'Upload program', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload program', exact: true });
  await dialog.getByLabel(/G-code file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  return dialog;
}

test('idle page requests one machine list and one status, and loads history only when opened', async ({ authedPage: page }) => {
  await page.clock.install(); const state = await fixtures(page); await page.goto('/programs');
  await expect(currentCard(page)).toContainText('O1234.nc');
  await page.clock.runFor(30_100);
  expect(state.requests.filter(r => r.path === '/api/programs/machines')).toHaveLength(1);
  expect(state.requests.filter(r => r.path.endsWith('/status'))).toHaveLength(1);
  expect(state.requests.filter(r => r.path === '/api/programs/files')).toHaveLength(0);
  await page.getByText('Saved files and backups', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved files and backups' })).toContainText('O1000.nc');
  expect(state.requests.filter(r => r.path === '/api/programs/files')).toHaveLength(1);
  await page.getByText('Device API guide', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download API guide' })).toHaveAttribute('href', '/integrations/PROGRAM_TRANSFER_DEVICE_API.md');
  await expect(page.locator('a[href*="postman"]')).toHaveCount(0);
});

test('idle device freshness expires locally and returning to the page refreshes one status', async ({ authedPage: page }) => {
  await page.clock.install(); const state = await fixtures(page); await page.goto('/programs');
  const badge = page.locator('.pt-device');
  await expect(badge).toHaveText('Device connected');
  await page.clock.runFor(60_100);
  await expect(badge).toHaveText('Device offline');
  expect(state.requests.filter(r => r.path.endsWith('/status'))).toHaveLength(1);
  state.machines[0].last_seen_at = new Date(await page.evaluate(() => Date.now())).toISOString();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(badge).toHaveText('Device connected');
  expect(state.requests.filter(r => r.path.endsWith('/status'))).toHaveLength(2);
});

test('a saved IP, program folder and device token are required before upload or backup', async ({ authedPage: page }) => {
  const state = await fixtures(page); state.machines[0].ip_address = ''; state.machines[0].program_path = '';
  await page.goto('/programs'); await expect(currentCard(page)).toContainText('O1234.nc');
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeDisabled();
  await page.getByLabel('Machine IP address', { exact: true }).fill('192.168.1.101');
  await page.getByLabel('Program folder on machine').fill('//CNC_MEM/USER/PATH1/');
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeEnabled();
  expect(state.requests.filter(r => r.method === 'PUT' && r.path.endsWith('/connection'))).toHaveLength(1);
});

test('server connection validation errors remain visible and keep upload disabled', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.route('**/api/programs/machines/7/connection', route => route.fulfill({ status: 400, json: { code: 'BAD_MACHINE_IP', message: 'Enter a valid IPv4 or IPv6 machine address.' } }));
  await page.goto('/programs'); await page.getByLabel('Machine IP address', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid IPv4');
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeDisabled();
});

test('an offline configured device can receive a queued upload with one idempotency key', async ({ authedPage: page }) => {
  const state = await fixtures(page); let body = '', requestKey = '';
  await page.route('**/api/programs/machines/8/transfer', route => {
    body = route.request().postData() || ''; requestKey = route.request().headers()['idempotency-key'];
    return route.fulfill(response({ file: file(8, 61, 'O3000.nc', 'NEW', true), job: job(8, 90) }, 201));
  });
  await page.goto('/programs'); await choose(page, 'VMC-2');
  await expect(page.getByText('The device is offline.', { exact: false })).toBeVisible();
  const dialog = await openUpload(page);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(currentCard(page)).toContainText('O3000.nc');
  await expect(currentCard(page)).toContainText('Saved on server');
  await expect(currentCard(page)).toContainText('Waiting for device');
  await expect(currentCard(page)).not.toContainText('Machine transfer verified');
  expect(body).toContain('filename="O3000.nc"'); expect(body).not.toContain('name="overwrite"');
  expect(requestKey).toMatch(/^[a-zA-Z0-9_-]{16,80}$/);
  expect(state.requests.some(r => r.path.includes('current-program'))).toBe(false);
});

test('a pending upload locks the form and cannot submit twice', async ({ authedPage: page }) => {
  await fixtures(page); const pending = gate(); let posts = 0;
  await page.route('**/api/programs/machines/7/transfer', async route => {
    posts++; await pending.promise; await route.fulfill(response({ file: file(7, 61, 'O3000.nc', 'NEW', true), job: job(7, 90) }, 201));
  });
  await page.goto('/programs'); const dialog = await openUpload(page);
  await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  await expect(dialog.getByLabel(/G-code file/)).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close upload' })).toBeDisabled();
  await expect(page.getByLabel('CNC Machine')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Uploading…', exact: true }).dispatchEvent('click');
  pending.release(); await expect(dialog).toHaveCount(0); expect(posts).toBe(1);
});

test('network retry reuses the same upload reference and preserves the selected file', async ({ authedPage: page }) => {
  await fixtures(page); const keys: string[] = [];
  await page.route('**/api/programs/machines/7/transfer', route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) return route.abort('failed');
    return route.fulfill(response({ file: file(7, 61, 'O3000.nc', 'NEW', true), job: job(7, 90) }, 201));
  });
  await page.goto('/programs'); const dialog = await openUpload(page);
  await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Retry uses the same request reference');
  await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
});

test('existing program replacement is exposed only after FILE_EXISTS and requires an explicit choice', async ({ authedPage: page }) => {
  await fixtures(page); const bodies: string[] = [], keys: string[] = [];
  await page.route('**/api/programs/machines/7/transfer', route => {
    bodies.push(route.request().postData() || ''); keys.push(route.request().headers()['idempotency-key']);
    if (bodies.length === 1) return route.fulfill({ status: 409, json: { code: 'FILE_EXISTS', message: 'Confirm replacement explicitly.' } });
    return route.fulfill(response({ file: file(7, 61, 'O3000.nc', 'NEW', true), job: job(7, 90) }, 201));
  });
  await page.goto('/programs'); const dialog = await openUpload(page); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  const replace = dialog.getByRole('checkbox', { name: 'Replace an existing program with this name on the controller' });
  await expect(replace).toBeVisible(); await expect(replace).not.toBeChecked(); expect(bodies).toHaveLength(1);
  await replace.check(); await dialog.getByRole('button', { name: 'Upload and send', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(bodies[0]).not.toContain('name="overwrite"'); expect(bodies[1]).toContain('name="overwrite"'); expect(keys[1]).not.toBe(keys[0]);
});

test('Backup requests a fresh device read each time and saved download remains a separate action', async ({ authedPage: page }) => {
  await page.clock.install(); const state = await fixtures(page); await page.goto('/programs'); await expect(currentCard(page)).toContainText('O1234.nc');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(backupCard(page)).toContainText('Waiting for device'); expect(state.downloads).toEqual([]);
  state.backups[7] = file(7, 71, 'RUNNING-A.nc', 'BACKUP'); state.jobs[7][0].status = 'DONE';
  await page.clock.runFor(5_100); await expect(backupCard(page)).toContainText('Fresh backup saved on server');
  await expect(backupCard(page)).toContainText('RUNNING-A.nc');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download saved backup', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('RUNNING-A.nc'); expect(state.downloads).toEqual([71]);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(backupCard(page)).toContainText('Waiting for device');
  const requests = state.requests.filter(r => r.path === '/api/programs/machines/7/backup'); expect(requests).toHaveLength(2); expect(requests[0].key).not.toBe(requests[1].key);
  await expect(currentCard(page)).toContainText('O1234.nc');
});

test('device errors display their exact reason and stop polling when the command is finished', async ({ authedPage: page }) => {
  await page.clock.install(); const state = await fixtures(page); state.jobs[7] = [job(7, 90, 'SEND', 'DELIVERED')];
  await page.goto('/programs'); await expect(currentCard(page)).toContainText('Device is transferring the file');
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeDisabled();
  state.jobs[7][0] = job(7, 90, 'SEND', 'FAILED', { error_code: 'PATH_NOT_FOUND', message: 'The controller folder does not exist.' });
  await page.clock.runFor(5_100); await expect(currentCard(page)).toContainText('PATH_NOT_FOUND');
  await expect(currentCard(page)).toContainText('The controller folder does not exist.');
  const completedCalls = state.requests.filter(r => r.path.endsWith('/status')).length;
  await page.clock.runFor(30_100); expect(state.requests.filter(r => r.path.endsWith('/status'))).toHaveLength(completedCalls);
});

test('status failure is shown as an error and cannot enable transfer', async ({ authedPage: page }) => {
  await fixtures(page); await page.route('**/api/programs/machines/7/status', route => route.fulfill({ status: 500, json: { message: 'Machine status is temporarily unavailable.' } }));
  await page.goto('/programs'); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(currentCard(page)).not.toContainText('No program uploaded yet.');
  await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toBeDisabled();
});

test('switching machines cancels stale status and saved file responses', async ({ authedPage: page }) => {
  await fixtures(page); const pending = gate(); let waiting = 0;
  await page.route('**/api/programs/machines/7/status', async route => {
    waiting++; await pending.promise; await route.fulfill(response({ machine: { id: 7, ip_address: 'wrong', program_path: 'wrong' }, file: file(7, 99, 'OLD.nc'), backup: null, jobs: [] })).catch(() => {});
  });
  await page.goto('/programs'); await expect.poll(() => waiting).toBe(1); await choose(page, 'VMC-2');
  await expect(currentCard(page)).toContainText('O8000.nc'); pending.release();
  await expect(page.getByLabel('Machine IP address', { exact: true })).toHaveValue('192.168.1.102');
  await expect(page.getByText('OLD.nc', { exact: true })).toHaveCount(0);
});

for (const role of ['read-only', 'upload-only']) {
  test(`${role} permissions cannot transfer, request backups, or edit connection`, async ({ page }) => {
    const permissions = ['page:programs:view', 'machine.view', ...(role === 'upload-only' ? ['page:programs:upload'] : [])];
    await seedAuth(page, { roles: ['SETTER'], permissions, company_permissions: permissions });
    await fixtures(page); await page.goto('/programs'); await expect(currentCard(page)).toContainText('O1234.nc');
    await expect(page.getByRole('button', { name: 'Upload program', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Backup', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save connection', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Machine IP address', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Device token', exact: true })).toHaveCount(0);
  });
}

test('device token replacement requires confirmation before invalidating the old token', async ({ authedPage: page }) => {
  await fixtures(page); let calls = 0;
  await page.route('**/api/programs/machines/7/device-token', route => { calls++; return route.fulfill(response({ token: 'mxd_' + 'x'.repeat(43), device: {} }, 201)); });
  await page.goto('/programs'); await page.getByRole('button', { name: 'Device token', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Device at VMC-1' });
  await dialog.getByRole('button', { name: 'New token', exact: true }).click(); expect(calls).toBe(0);
  await dialog.getByRole('button', { name: 'Yes, replace it', exact: true }).click();
  await expect(dialog.getByLabel('Device configuration')).toBeVisible(); expect(calls).toBe(1);
});

test('connection screen and upload dialog fit phones, tablets and desktop', async ({ authedPage: page }, testInfo) => {
  await fixtures(page); await page.goto('/programs'); await expect(currentCard(page)).toContainText('O1234.nc');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`programs-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 }); const dialog = await openUpload(page);
  await expect(dialog).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('creating a line requires a selected plant and sends that plant in the request', async ({ page }) => {
  await seedAuth(page, { plant_id: null }); await fixtures(page); let created: any;
  await page.route('**/api/master/plants', route => route.fulfill(response([{ id: 1, plant_name: 'Plant A' }, { id: 2, plant_name: 'Plant B' }])));
  await page.route('**/api/lines', route => {
    if (route.request().method() === 'POST') { created = route.request().postDataJSON(); return route.fulfill(response({ id: 10, ...created }, 201)); }
    return route.fulfill(response([]));
  });
  await page.goto('/lines'); await page.getByRole('button', { name: 'New Line' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Line' });
  await dialog.getByLabel('Line name').fill('Production A'); await dialog.getByRole('button', { name: 'Create line' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose the plant'); expect(created).toBeUndefined();
  await dialog.getByLabel('Plant', { exact: false }).selectOption({ label: 'Plant B' });
  await dialog.getByRole('button', { name: 'Create line' }).click(); await expect(dialog).toHaveCount(0);
  expect(created).toEqual({ name: 'Production A', plant_id: 2, is_active: true });
});

test('machine registration filters lines by plant and keeps transfer settings on Program Transfer', async ({ page }) => {
  await seedAuth(page, { plant_id: null }); await fixtures(page);
  await page.route('**/api/master/plants', route => route.fulfill(response([{ id: 1, plant_name: 'Plant A' }, { id: 2, plant_name: 'Plant B' }])));
  await page.route('**/api/lines', route => route.fulfill(response([{ id: 10, plant_id: 1, name: 'Line A' }, { id: 20, plant_id: 2, name: 'Line B' }])));
  await page.goto('/machines'); await page.getByRole('button', { name: 'New Machine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Machine' });
  await dialog.getByLabel('Plant', { exact: false }).selectOption({ label: 'Plant A' });
  const lines = dialog.getByLabel('Production line', { exact: false });
  await expect(lines.locator('option')).toHaveText(['Select a line', 'Line A']); await lines.selectOption({ label: 'Line A' });
  await dialog.getByLabel('Plant', { exact: false }).selectOption({ label: 'Plant B' });
  await expect(lines.locator('option')).toHaveText(['Select a line', 'Line B']); await expect(lines).toHaveValue('0: null');
  await expect(dialog.getByLabel(/IP address|Program path|Program folder/)).toHaveCount(0);
});
