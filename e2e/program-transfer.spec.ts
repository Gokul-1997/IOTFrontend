import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Program Transfer through each machine's device. The server keeps the files
 * (ProgramTransfer/<company>/<machine IP>/) and hands out jobs; the device at
 * the machine collects them. So the page shows the device's state, sends by
 * queueing a job ("Waiting for the device"), asks before overwriting what the
 * device reported on the controller, and gives out a device token once.
 */

const ok = (body: any, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

const machines = [
  { id: 7, machine_serial_no: 'VMC-1', ip_address: '192.168.200.3', program_path: '//CNC_MEM/USER/PATH1/', folder: 'company-5/192.168.200.3', device_id: 3,
    token_prefix: 'mxd_AbCdEfGh', device_label: 'Pi at VMC-1', device_created_at: ago(86400), last_seen_at: ago(12),
    last_seen_ip: '203.0.113.9', agent_version: '1.0.0', online: true, open_jobs: 0, controller_reported_at: ago(90) },
  { id: 8, machine_serial_no: 'VMC-2', ip_address: '192.168.200.4', program_path: null, folder: 'company-5/192.168.200.4', device_id: null,
    token_prefix: null, device_label: null, device_created_at: null, last_seen_at: null, last_seen_ip: null,
    agent_version: null, online: false, open_jobs: 0, controller_reported_at: null }
];
const files = [
  { id: 40, machine_id: 7, machine_serial_no: 'VMC-1', folder: 'company-5/192.168.200.3', stored_name: '20261005-103012_NEW_O1234.nc',
    program_name: 'O1234.nc', kind: 'NEW', size_bytes: 2048, sha256: 'a'.repeat(64), note: 'rev C', job_id: null, created_at: ago(3600), uploaded_by_name: 'Priya' },
  { id: 41, machine_id: 7, machine_serial_no: 'VMC-1', folder: 'company-5/192.168.200.3', stored_name: '20261005-103020_BACKUP_O1234.nc',
    program_name: 'O1234.nc', kind: 'BACKUP', size_bytes: 1990, sha256: 'b'.repeat(64), note: null, job_id: 1, created_at: ago(3500), uploaded_by_name: null }
];
const job = (o: any = {}) => ({ id: 11, machine_id: 7, machine_serial: 'VMC-1', action: 'SEND', program_name: 'O1234.nc', overwrite: false,
  program_path: '//CNC_MEM/USER/PATH1/', target_file: '//CNC_MEM/USER/PATH1/O1234.nc',
  status: 'QUEUED', message: null, file_id: 40, file_name: '20261005-103012_NEW_O1234.nc', backup_file_id: null, backup_name: null,
  file_size: 2048, requested_by_name: 'Priya', requested_at: ago(5), delivered_at: null, finished_at: null, ...o });

async function stub(page: any, opts: { open?: any[]; history?: any[] } = {}) {
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/programs/machines', (r: any) => r.fulfill(ok({ status: 'success', data: machines })));
  await page.route('**/api/programs/machines/*/controller-files', (r: any) => r.fulfill(ok({ status: 'success', data: {
    files: [{ name: 'O1234.nc', size: 2010, modified: ago(7200), comment: null }, { name: 'O2001', size: 512, modified: null, comment: 'FLANGE' }],
    reported_at: ago(90) } })));
  await page.route('**/api/programs/files?*', (r: any) => r.fulfill(ok({ status: 'success', data: files, total: files.length })));
  await page.route('**/api/programs/jobs?*', (r: any) => {
    const open = new URL(r.request().url()).searchParams.get('status') === 'open';
    const data = open ? (opts.open || []) : (opts.history || []);
    return r.fulfill(ok({ status: 'success', data, total: data.length }));
  });
}

test('the machine, its device and its program path are shown first — not the server folder', async ({ authedPage: page }) => {
  await stub(page);
  await page.goto('/programs');
  await expect(page.getByLabel('CNC Machine')).toHaveValue(/./);
  await expect(page.getByRole('status').filter({ hasText: 'Online' })).toContainText('checked in');
  await expect(page.getByText('Program path on the machine')).toBeVisible();
  await expect(page.getByText('//CNC_MEM/USER/PATH1/', { exact: true })).toBeVisible();
  await expect(page.getByText(/ProgramTransfer\//)).toHaveCount(0);
  await expect(page.getByText('20261005-103020_BACKUP_O1234.nc')).toBeVisible();
  await expect(page.getByRole('region', { name: /on the machine's controller/ }).getByText('O2001')).toBeVisible();

  // a machine without a device or a program path says so, and sends nothing
  await page.getByLabel('CNC Machine').selectOption({ label: 'VMC-2 — 192.168.200.4' });
  await expect(page.getByRole('status').filter({ hasText: 'No device linked' })).toBeVisible();
  await expect(page.getByText(/has no device linked yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link a device' })).toBeVisible();
  await expect(page.getByText('Not set', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'VMC-2 has no program path yet' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select 20261005-103012_NEW_O1234.nc' }).check();
  await expect(page.getByRole('button', { name: /Send to VMC-2/ })).toBeDisabled();
});

test('the program path is set right there, for the machine', async ({ authedPage: page }) => {
  await stub(page);
  let put: any = null;
  await page.route('**/api/machines/8', (r: any) => { put = r.request().postDataJSON(); return r.fulfill(ok({ status: 'success', data: {} })); });
  await page.goto('/programs');
  await page.getByLabel('CNC Machine').selectOption({ label: 'VMC-2 — 192.168.200.4' });
  await page.getByRole('button', { name: 'Set the program path for VMC-2' }).click();
  // empty is not a path
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the folder on the machine');
  await page.getByLabel('Program path on the machine').fill('M01:\\PRG\\USER\\');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => put).toEqual({ program_path: 'M01:\\PRG\\USER\\' });
});

test('send queues a job; a program already on the machine asks before overwriting', async ({ authedPage: page }) => {
  await stub(page);
  const posts: any[] = [];
  await page.route('**/api/programs/jobs', (r: any) => {
    const body = r.request().postDataJSON();
    posts.push(body);
    return body.overwrite
      ? r.fulfill(ok({ status: 'success', data: { jobs: [job({ overwrite: true })] } }, 201))
      : r.fulfill(ok({ status: 'error', code: 'FILE_EXISTS', names: ['O1234.nc on VMC-1'], message: 'Already on the machine' }, 409));
  });
  await page.goto('/programs');
  await page.getByRole('checkbox', { name: 'Select 20261005-103012_NEW_O1234.nc' }).check();
  await page.getByRole('button', { name: /Send to VMC-1/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Already on the machine' });
  await expect(dialog).toContainText('O1234.nc on VMC-1');
  await expect(dialog).toContainText('saves the one on the machine as a Backup');
  await dialog.getByRole('button', { name: 'Overwrite' }).click();

  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([
    { action: 'SEND', file_ids: [40], machine_ids: [7], overwrite: false },
    { action: 'SEND', file_ids: [40], machine_ids: [7], overwrite: true }
  ]);
});

test('jobs still with the device are listed, and a queued one can be cancelled', async ({ authedPage: page }) => {
  await stub(page, { open: [job(), job({ id: 12, action: 'FETCH', program_name: 'O2001', status: 'DELIVERED', file_id: null })] });
  let cancelled = false;
  await page.route('**/api/programs/jobs/11/cancel', (r: any) => { cancelled = true; return r.fulfill(ok({ status: 'success', data: job({ status: 'CANCELLED' }) })); });
  await page.goto('/programs');
  const inProgress = page.locator('.pt-jobs');
  await expect(inProgress).toContainText('Waiting for the device');
  await expect(inProgress).toContainText('Taken by the device');
  // the device has already taken the FETCH: no cancel for it
  await expect(page.getByRole('button', { name: 'Cancel O2001' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel O1234.nc' }).click();
  await expect.poll(() => cancelled).toBe(true);
});

test('Get asks the device for a program on the controller', async ({ authedPage: page }) => {
  await stub(page);
  let body: any = null;
  await page.route('**/api/programs/jobs', (r: any) => { body = r.request().postDataJSON(); return r.fulfill(ok({ status: 'success', data: { jobs: [job({ action: 'FETCH' })] } }, 201)); });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Copy O2001 to the server folder' }).click();
  await expect.poll(() => body).toEqual({ action: 'FETCH', machine_id: 7, program_names: ['O2001'] });
});

test('upload goes into the chosen machine\'s folder and can be sent at once', async ({ authedPage: page }) => {
  await stub(page);
  let sent = '';
  await page.route('**/api/programs/files', (r: any) => {
    sent = r.request().postData() || '';
    return r.fulfill(ok({ status: 'success', data: { file: files[0], job: job() }, message: 'Uploaded and queued' }, 201));
  });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Upload Program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Program' });
  await dialog.getByLabel(/G-code file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  await expect(dialog.getByLabel('Name on the machine')).toHaveValue('O3000.nc');
  await expect(dialog.getByRole('checkbox', { name: /Send it to VMC-1 now/ })).toBeChecked();
  await expect(dialog).toContainText('Its device saves it at //CNC_MEM/USER/PATH1/O3000.nc');
  await dialog.getByRole('button', { name: 'Upload & Send' }).click();
  await expect(dialog).toHaveCount(0);
  for (const part of ['name="machine_id"\r\n\r\n7', 'name="send"\r\n\r\ntrue', 'name="overwrite"\r\n\r\nfalse', 'filename="O3000.nc"']) {
    expect(sent).toContain(part);
  }
});

test('a device token is shown once, as the device\'s configuration', async ({ authedPage: page }) => {
  await stub(page);
  await page.route('**/api/programs/machines/7/device-token', (r: any) => r.fulfill(ok({ status: 'success',
    data: { token: 'mxd_' + 'x'.repeat(43), device: { id: 4 } } }, 201)));
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Device token' }).click();
  const dialog = page.getByRole('dialog', { name: 'Device at VMC-1' });
  await expect(dialog).toContainText('mxd_AbCdEfGh…');
  await expect(dialog).toContainText('203.0.113.9');

  // replacing a live token takes a second, explicit yes
  await dialog.getByRole('button', { name: 'New token' }).click();
  await expect(dialog.getByRole('alert')).toContainText('stops working at once');
  await dialog.getByRole('button', { name: 'Yes, replace it' }).click();

  const config = dialog.getByLabel('Device configuration');
  await expect(config).toContainText('MEXA_URL=http://localhost:8000');
  await expect(config).toContainText('MEXA_DEVICE_TOKEN=mxd_' + 'x'.repeat(43));
  await expect(dialog).toContainText('shown only once');

  // how to use it comes with it: which call does what, and samples holding this token and path
  const help = dialog.getByRole('region', { name: 'How the device uses the token' });
  await expect(help.getByRole('table')).toContainText('POST /files with type=BACKUP');
  await expect(help.getByRole('table')).toContainText('POST /files with type=FETCHED');
  await expect(help.getByLabel('Python sample')).toContainText('TOKEN = "mxd_' + 'x'.repeat(43) + '"');
  await help.getByRole('button', { name: 'curl', exact: true }).click();
  await expect(help.getByLabel('curl sample')).toContainText('-F type=BACKUP');
  await expect(help.getByLabel('curl sample')).toContainText('//CNC_MEM/USER/PATH1/O1234.nc');
});

test('a machine without a program path gets one before its device token', async ({ authedPage: page }) => {
  await stub(page);
  const calls: string[] = [];
  await page.route('**/api/machines/8', (r: any) => { calls.push('path ' + r.request().postDataJSON().program_path); return r.fulfill(ok({ status: 'success', data: {} })); });
  await page.route('**/api/programs/machines/8/device-token', (r: any) => { calls.push('token'); return r.fulfill(ok({ status: 'success', data: { token: 'mxd_' + 'y'.repeat(43), device: {} } }, 201)); });
  await page.goto('/programs');
  await page.getByLabel('CNC Machine').selectOption({ label: 'VMC-2 — 192.168.200.4' });
  await page.getByRole('button', { name: 'Link a device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Device at VMC-2' });
  await expect(dialog.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await dialog.getByLabel(/Program path on the machine/).fill('//CNC_MEM/USER/PATH1/');
  await dialog.getByRole('button', { name: 'Create token' }).click();
  await expect(dialog.getByLabel('Device configuration')).toContainText('mxd_' + 'y'.repeat(43));
  expect(calls).toEqual(['path //CNC_MEM/USER/PATH1/', 'token']);
});

test('a role that may only look sees no upload, send, get, delete or device controls', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:programs:view', 'machine.view'], company_permissions: ['page:programs:view'] });
  await stub(page);
  await page.goto('/programs');
  await expect(page.getByText('20261005-103012_NEW_O1234.nc')).toBeVisible();
  for (const name of ['Upload Program', /Send to/, 'Device token']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Copy .* to the server folder/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText('Sending to a machine is not part of your role.')).toBeVisible();
});

test('the history says what happened, including the program kept before an overwrite', async ({ authedPage: page }) => {
  await stub(page, { history: [
    job({ status: 'DONE', overwrite: true, backup_name: '20261005-103020_BACKUP_O1234.nc', finished_at: ago(1) }),
    job({ id: 12, action: 'FETCH', program_name: 'MISSING.nc', status: 'FAILED', message: 'MISSING.nc is not on the controller.', file_id: null, file_name: null })
  ] });
  await page.goto('/programs');
  await page.getByRole('tab', { name: /Transfer History/ }).click();
  const table = page.getByRole('region', { name: 'Transfer history' });
  await expect(table).toContainText('To machine');
  await expect(table).toContainText('From machine');
  await expect(table).toContainText('MISSING.nc is not on the controller.');
  await expect(table.getByTitle('20261005-103020_BACKUP_O1234.nc')).toContainText('Kept');
});
