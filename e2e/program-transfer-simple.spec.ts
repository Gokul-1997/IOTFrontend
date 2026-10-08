import type { Page, Route } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

const localOrigin = 'http://127.0.0.1:4495';
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const response = (data: unknown, status = 200) => ({ status, json: { status: 'success', data } });
const machines = [7, 8].map((id, index) => ({
  id, machine_serial_no: `VMC-${index + 1}`, ip_address: `192.168.200.${index + 3}`,
  program_path: '//CNC_MEM/USER/PATH1/', folder: `company-4/192.168.200.${index + 3}`,
  device_id: index + 3, device_label: `Device ${index + 1}`, token_prefix: 'mxd_example',
  device_created_at: ago(86400), last_seen_at: ago(5), last_seen_ip: '192.0.2.10',
  agent_version: '1.0.0', online: true, open_jobs: 0, controller_reported_at: ago(5)
}));
const file = (machineId: number, id: number, name: string, kind = 'NEW') => ({
  id, machine_id: machineId, machine_serial_no: machineId === 7 ? 'VMC-1' : 'VMC-2',
  folder: `company-4/machine-${machineId}`, stored_name: `20261008-103012_${kind}_${name}`,
  program_name: name, kind, size_bytes: 2048, sha256: 'a'.repeat(64), note: null,
  job_id: null, created_at: ago(60), uploaded_by_name: 'Operator'
});
const job = (overrides: Record<string, unknown> = {}) => ({
  id: 11, machine_id: 7, machine_serial: 'VMC-1', action: 'SEND', program_name: 'O1234.nc',
  program_path: '//CNC_MEM/USER/PATH1/', target_file: '//CNC_MEM/USER/PATH1/O1234.nc',
  overwrite: false, status: 'QUEUED', message: null, file_id: 40,
  file_name: '20261008-103012_NEW_O1234.nc', backup_file_id: null, backup_name: null,
  file_size: 2048, requested_by_name: 'Operator', requested_at: ago(5),
  delivered_at: null, finished_at: null, ...overrides
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function fixtures(page: Page) {
  const state = {
    files: { 7: [file(7, 40, 'O1234.nc')], 8: [file(8, 50, 'O8000.nc')] } as Record<number, ReturnType<typeof file>[]>,
    open: { 7: [], 8: [] } as Record<number, ReturnType<typeof job>[]>,
    history: { 7: [], 8: [] } as Record<number, ReturnType<typeof job>[]>,
    fileRequests: [] as number[],
    jobRequests: [] as { machineId: number; open: boolean }[],
    downloads: [] as number[]
  };
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) {
      return url.origin === localOrigin ? route.continue() : route.abort();
    }
    const path = url.pathname;
    if (path === '/api/programs/machines') return route.fulfill(response(machines));
    const controller = path.match(/^\/api\/programs\/machines\/(\d+)\/controller-files$/);
    if (controller) return route.fulfill(response({
      files: [{ name: Number(controller[1]) === 7 ? 'O2001.nc' : 'O8001.nc', size: 512, modified: null, comment: null }],
      reported_at: ago(10)
    }));
    if (path === '/api/programs/files' && request.method() === 'GET') {
      const machineId = Number(url.searchParams.get('machine_id'));
      state.fileRequests.push(machineId);
      const data = state.files[machineId] || [];
      return route.fulfill({ json: { status: 'success', data, total: data.length } });
    }
    if (path === '/api/programs/jobs' && request.method() === 'GET') {
      const machineId = Number(url.searchParams.get('machine_id'));
      const open = url.searchParams.get('status') === 'open';
      state.jobRequests.push({ machineId, open });
      const data = (open ? state.open : state.history)[machineId] || [];
      return route.fulfill({ json: { status: 'success', data, total: data.length } });
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

async function choose(page: Page, machine: 'VMC-1' | 'VMC-2') {
  await page.getByLabel('CNC Machine').selectOption({ label: `${machine} — 192.168.200.${machine === 'VMC-1' ? 3 : 4}` });
}

test('a new file sends to the selected machine in one simple upload', async ({ authedPage: page }) => {
  await fixtures(page);
  let multipart = '';
  await page.route('**/api/programs/files', route => {
    multipart = route.request().postData() || '';
    return route.fulfill(response({ file: file(7, 60, 'O3000.nc'), job: job({ program_name: 'O3000.nc' }) }, 201));
  });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Send a new file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send a program', exact: true });
  await expect(dialog).toContainText('VMC-1');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByLabel(/G-code file/).setInputFiles({
    name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n')
  });
  await expect(dialog.getByRole('checkbox', { name: /Send/ })).toBeChecked();
  await dialog.getByRole('button', { name: /Upload & Send|Send program|Send to VMC-1/ }).click();
  await expect(dialog).toHaveCount(0);
  for (const part of ['name="machine_id"\r\n\r\n7', 'name="send"\r\n\r\ntrue', 'name="overwrite"\r\n\r\nfalse', 'filename="O3000.nc"']) {
    expect(multipart).toContain(part);
  }
});

test('an upload locks its fields and retries the same file only after overwrite confirmation', async ({ authedPage: page }) => {
  await fixtures(page);
  const pending = gate();
  const uploads: string[] = [];
  await page.route('**/api/programs/files', async route => {
    uploads.push(route.request().postData() || '');
    if (uploads.length === 1) {
      await pending.promise;
      return route.fulfill({ status: 409, json: { code: 'FILE_EXISTS', names: ['O3000.nc on VMC-1'] } });
    }
    return route.fulfill(response({ file: file(7, 60, 'O3000.nc'), job: job({ program_name: 'O3000.nc' }) }, 201));
  });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Send a new file', exact: true }).click();
  const upload = page.getByRole('dialog', { name: 'Send a program', exact: true });
  await upload.getByLabel(/G-code file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  await upload.getByRole('button', { name: 'Send program', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(1);
  await expect(upload.getByLabel(/G-code file/)).toBeDisabled();
  await expect(upload.getByRole('button', { name: 'Close without uploading' })).toBeDisabled();
  pending.release();
  const overwrite = page.getByRole('dialog', { name: 'Already on the machine' });
  await expect(overwrite).toContainText('VMC-1');
  await expect(upload.getByLabel(/G-code file/)).toBeDisabled();
  await overwrite.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await expect(upload).toHaveCount(0);
  expect(uploads).toHaveLength(2);
  uploads.forEach((body, index) => {
    expect(body).toContain('name="machine_id"\r\n\r\n7');
    expect(body).toContain('filename="O3000.nc"');
    expect(body).toContain(`name="overwrite"\r\n\r\n${index === 1}`);
  });
});

test('an overwrite confirmation keeps its original machine and file after a pending request', async ({ authedPage: page }) => {
  await fixtures(page);
  const firstResponse = gate();
  const posts: unknown[] = [];
  await page.route('**/api/programs/jobs', async route => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (!body.overwrite) {
      await firstResponse.promise;
      return route.fulfill({ status: 409, json: { code: 'FILE_EXISTS', names: ['O1234.nc on VMC-1'], message: 'Already on the machine' } });
    }
    return route.fulfill(response({ jobs: [job({ overwrite: true })] }, 201));
  });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Send O1234.nc', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  await choose(page, 'VMC-2');
  firstResponse.release();
  const dialog = page.getByRole('dialog', { name: 'Already on the machine' });
  await expect(dialog).toContainText('VMC-1');
  await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([
    { action: 'SEND', file_ids: [40], machine_ids: [7], overwrite: false },
    { action: 'SEND', file_ids: [40], machine_ids: [7], overwrite: true }
  ]);
  await expect(page.getByRole('button', { name: 'Send O8000.nc', exact: true })).toBeVisible();
});

test('rapid Get clicks queue only one request while the first request is pending', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  const pending = gate();
  const posts: unknown[] = [];
  await page.route('**/api/programs/jobs', async route => {
    posts.push(route.request().postDataJSON());
    await pending.promise;
    const fetch = job({ action: 'FETCH', program_name: 'O2001.nc', file_id: null, file_name: null });
    state.open[7] = [fetch];
    return route.fulfill(response({ jobs: [fetch] }, 201));
  });
  await page.goto('/programs');
  await page.getByRole('tab', { name: 'Get from machine', exact: true }).click();
  const get = page.getByRole('button', { name: 'Get O2001.nc', exact: true });
  await get.click();
  await expect(get).toBeDisabled();
  await get.dispatchEvent('click');
  pending.release();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'FETCH', machine_id: 7, program_names: ['O2001.nc'] });
  await expect(get).toBeDisabled();
});

test('switching machines discards delayed file and history responses', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  const oldFiles = gate();
  const oldHistory = gate();
  let filesWaiting = false;
  let historyWaiting = false;
  state.history[8] = [job({ id: 21, machine_id: 8, machine_serial: 'VMC-2', program_name: 'O8000.nc', status: 'DONE' })];
  await page.route('**/api/programs/files?*', async route => {
    if (new URL(route.request().url()).searchParams.get('machine_id') !== '7') return route.fallback();
    filesWaiting = true;
    await oldFiles.promise;
    await route.fulfill({ json: { data: state.files[7], total: 1 } }).catch(() => {});
  });
  await page.route('**/api/programs/jobs?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('machine_id') !== '7' || query.get('status') === 'open') return route.fallback();
    historyWaiting = true;
    await oldHistory.promise;
    await route.fulfill({ json: { data: [job({ program_name: 'OLD-MACHINE.nc', status: 'FAILED' })], total: 1 } }).catch(() => {});
  });
  await page.goto('/programs');
  await expect.poll(() => filesWaiting).toBe(true);
  await choose(page, 'VMC-2');
  await expect(page.getByRole('button', { name: 'Send O8000.nc', exact: true })).toBeVisible();
  oldFiles.release();
  await expect(page.getByRole('button', { name: 'Send O1234.nc', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Transfer History', exact: true }).click();
  await choose(page, 'VMC-1');
  await expect.poll(() => historyWaiting).toBe(true);
  await choose(page, 'VMC-2');
  const history = page.getByRole('region', { name: 'Transfer history', exact: true });
  await expect(history).toContainText('O8000.nc');
  oldHistory.release();
  // Give the released response a browser turn to arrive before asserting final ownership.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(history).not.toContainText('OLD-MACHINE.nc');
  await expect(history).toContainText('O8000.nc');
});

test('HTTP polling makes a completed Get visible and downloadable without a socket', async ({ authedPage: page }) => {
  await page.clock.install();
  const state = await fixtures(page);
  // The shared seed expires in a year. Fake browser timers clamp that refresh
  // timeout; answer the refresh with a realistic one-hour token, entirely locally.
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.e2e`;
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { accessToken: jwt, refreshToken: jwt } }));
  const pending = job({ action: 'FETCH', program_name: 'O2001.nc', status: 'DELIVERED', file_id: null, file_name: null });
  state.open[7] = [pending];
  state.history[7] = [pending];
  await page.goto('/programs');
  await page.getByRole('tab', { name: 'Transfer History', exact: true }).click();
  const history = page.getByRole('region', { name: 'Transfer history', exact: true });
  await expect(history).toContainText('O2001.nc');
  const fetched = file(7, 60, 'O2001.nc', 'FETCHED');
  state.files[7].push(fetched);
  state.open[7] = [];
  state.history[7] = [job({ ...pending, status: 'DONE', file_id: 60, file_name: fetched.stored_name, finished_at: ago(0) })];
  await page.clock.runFor(10_100);
  const completed = history.getByRole('row').filter({ hasText: 'O2001.nc' });
  await expect(completed).toContainText('Done');
  const download = page.waitForEvent('download');
  await completed.getByRole('button', { name: /^Download/ }).click();
  expect((await download).suggestedFilename()).toMatch(/O2001/);
  expect(state.downloads).toEqual([60]);
});

test('Send, Get, History and upload fit a 390px phone', async ({ authedPage: page }, testInfo) => {
  const state = await fixtures(page);
  state.history[7] = [job({ status: 'FAILED', message: 'Controller is busy. Try after machining finishes.' })];
  await page.goto('/programs');
  await expect(page.getByRole('button', { name: 'Send O1234.nc', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('send-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['Send to machine', 'Get from machine', 'Transfer History']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.getByText('Controller is busy. Try after machining finishes.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Send to machine', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Send to machine', exact: true })).toHaveClass(/is-active/);
  await expect(page.getByRole('tab', { name: 'Transfer History', exact: true })).not.toHaveClass(/is-active/);
  await page.screenshot({ path: testInfo.outputPath('send-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Send a new file', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Send a program', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('upload-mobile.png'), fullPage: true, animations: 'disabled' });
});

test('a read-only role can inspect programs but cannot send, get, delete or change setup', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:programs:view', 'machine.view'], company_permissions: ['page:programs:view'] });
  await fixtures(page);
  await page.goto('/programs');
  await expect(page.getByText('O1234.nc', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Send O/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Get from machine', exact: true }).click();
  await expect(page.getByText('O2001.nc', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Get O/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Device token', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /the program path for/ })).toHaveCount(0);
});

test('Postman downloads are available from the screen and contain blank credentials', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.goto('/programs');
  await page.getByText('Postman / API guide', { exact: true }).click();
  for (const label of ['Collection', 'Environment', 'Send / Get guide']) {
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const result = await page.request.get((await link.getAttribute('href'))!);
    expect(result.ok()).toBe(true);
    if (label === 'Collection') expect((await result.json()).info.schema).toContain('/v2.1.0/');
    if (label === 'Environment') {
      const environment = await result.json();
      for (const key of ['email', 'password', 'access_token', 'refresh_token', 'device_token']) {
        expect(environment.values.find((value: { key: string }) => value.key === key).value).toBe('');
      }
    }
    if (label === 'Send / Get guide') expect(await result.text()).toContain('Get a program from the machine');
  }
});
