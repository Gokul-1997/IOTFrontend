import type { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Program Transfer, kept simple (21 Oct 2026): choose a machine, upload its
 * programs, download files, ask for a backup. No company or plant pickers,
 * no FTP/FANUC settings. Since 22 Oct 2026 the company has one gateway for
 * all its machines — S&T makes its token, so this page makes none and only
 * says whether it is online — and programs wait in line per machine.
 *
 * Run with its own config: npx playwright test -c playwright.program-transfer.config.ts
 */
const localOrigin = 'http://127.0.0.1:4495';
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const ok = (data: unknown, status = 200) => ({ status, json: { status: 'success', data } });

type Report = { id: number; program_name: string; delivery_status: 'DONE' | 'FAILED'; delivery_message: string | null; delivered_at: string | null };
type Machine = {
  id: number; machine_serial_no: string;
  next: { id: number; program_name: string; size_bytes: number; created_at: string } | null;
  waiting: number;
  last_report: Report | null;
  last_backup: { id: number; program_name: string; created_at: string } | null;
  backup_request: { id: number; requested_at: string } | null;
  backup_failure?: { message: string; at: string } | null;
};
const fileRow = (id: number, machine: number, name: string, kind = 'NEW', delivery: any = {}) => ({
  id, machine_id: machine, program_name: name, kind, size_bytes: 2048, sha256: 'a'.repeat(64),
  created_at: ago(id), uploaded_by_name: kind === 'NEW' ? 'Ravi' : null, queue_position: null,
  delivery_status: null, delivery_message: null, delivered_at: null, ...delivery
});

async function fixtures(page: Page) {
  const state = {
    gateway: { token_prefix: 'mxg_abcdefgh', token_created_at: ago(86400), last_seen_at: ago(5), online: true } as any,
    machines: [
      { id: 7, machine_serial_no: 'VMC-1', next: null, waiting: 0,
        last_report: { id: 40, program_name: 'O1234.nc', delivery_status: 'DONE', delivery_message: null, delivered_at: ago(500) },
        last_backup: null, backup_request: null },
      { id: 8, machine_serial_no: 'VMC-2', next: null, waiting: 0, last_report: null, last_backup: null, backup_request: null }
    ] as Machine[],
    files: { 7: [fileRow(40, 7, 'O1234.nc', 'NEW', { delivery_status: 'DONE', delivered_at: ago(500) }),
                 fileRow(39, 7, 'O1000.nc', 'NEW', { delivery_status: 'FAILED', delivery_message: 'Program O1000 is running', delivered_at: ago(900) })],
             8: [] } as Record<number, any[]>,
    calls: [] as { method: string; path: string; query: string }[],
    uploads: [] as string[]
  };
  let nextId = 41;
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (!path.startsWith('/api/')) return url.origin === localOrigin ? route.continue() : route.abort();
    state.calls.push({ method, path, query: url.search });
    if (path === '/api/programs/machines') return route.fulfill({ json: { status: 'success', data: state.machines, gateway: state.gateway } });
    if (path === '/api/programs/files' && method === 'GET') {
      const machine = Number(url.searchParams.get('machine_id')), kind = url.searchParams.get('kind');
      const rows = (state.files[machine] || []).filter(f => !kind || (kind === 'uploads' ? f.kind === 'NEW' : f.kind !== 'NEW'));
      return route.fulfill({ json: { status: 'success', data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } } });
    }
    if (path === '/api/programs/files' && method === 'POST') {
      const body = request.postDataBuffer()?.toString('latin1') || '';
      state.uploads.push(body);
      const m = state.machines.find(x => body.includes(`\r\n\r\n${x.id}\r\n`))!;
      const name = body.match(/filename="([^"]+)"/)?.[1] || 'O3000.nc';
      m.waiting += 1;
      const row = fileRow(nextId++, m.id, name, 'NEW', { created_at: ago(0), queue_position: m.waiting });
      state.files[m.id] = [row, ...state.files[m.id]];
      m.next ??= { id: row.id, program_name: name, size_bytes: 2048, created_at: ago(0) };
      return route.fulfill(ok(row, 201));
    }
    const backup = path.match(/^\/api\/programs\/machines\/(\d+)\/backup$/);
    if (backup) {
      const m = state.machines.find(x => x.id === Number(backup[1]))!;
      m.backup_request = { id: 9, requested_at: ago(0) };
      return route.fulfill(ok({ ...m.backup_request, created: true }, 201));
    }
    if (path.match(/^\/api\/programs\/files\/\d+\/download$/)) return route.fulfill({ contentType: 'application/octet-stream', body: '%\nO1234\nM30\n%\n' });
    const remove = path.match(/^\/api\/programs\/files\/(\d+)$/);
    if (remove && method === 'DELETE') {
      for (const id of Object.keys(state.files)) state.files[Number(id)] = state.files[Number(id)].filter(f => f.id !== Number(remove[1]));
      return route.fulfill(ok({ deleted: true }));
    }
    return route.fulfill(ok([]));
  });
  return state;
}

const filesTable = (page: Page) => page.getByRole('region', { name: 'Program files' });
const programCard = (page: Page) => page.getByRole('region', { name: 'Programs for the machine' });

test('only a machine to choose: no company, no plant, no FTP or FANUC settings; the company\'s one gateway is online', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(page.getByRole('heading', { name: 'Program Transfer' })).toBeVisible();
  await expect(page.getByLabel('Machine', { exact: true })).toHaveValue(/.+/);
  for (const gone of [/plant/i, /company/i, /protocol/i, /ftp/i, /focas/i, /queue/i]) {
    await expect(page.getByLabel(gone)).toHaveCount(0);
  }
  await expect(page.getByText('Gateway online')).toBeVisible();
  await expect(filesTable(page).locator('tbody tr')).toHaveCount(2);
  await expect(programCard(page)).toContainText('O1234.nc on the machine since');
  await expect(programCard(page)).toContainText('Nothing waiting to be sent.');

  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC-2' });
  await expect(programCard(page)).toContainText('Nothing waiting to be sent.');
  await expect(page.getByText('Gateway online')).toBeVisible();                   // one gateway for every machine
  expect(state.calls.some(c => c.path === '/api/programs/files' && c.query.includes('machine_id=8'))).toBe(true);
});

test('two uploads for one machine wait in line: the first is next to send, the second waits behind it', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Upload program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload program' });
  await expect(dialog).toContainText('It joins the machine\'s line');
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose the program file.');
  await dialog.getByLabel(/Program file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain('name="machine_id"\r\n\r\n7\r\n');
  expect(state.uploads[0]).toContain('filename="O3000.nc"');
  await expect(page.getByText('O3000.nc is next to send to VMC-1')).toBeVisible();
  await expect(programCard(page)).toContainText('O3000.nc');
  await expect(programCard(page)).toContainText('Next to send — waiting for the gateway');
  await expect(filesTable(page).locator('tbody tr').first()).toContainText('Next to send');

  await page.getByRole('button', { name: 'Upload program' }).click();
  await dialog.getByLabel(/Program file/).setInputFiles({ name: 'O3001.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3001\nM30\n%\n') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('O3001.nc is 2nd in line for VMC-1')).toBeVisible();
  await expect(programCard(page)).toContainText('O3000.nc');                       // the first still goes first
  await expect(programCard(page)).toContainText('1 more after it');
  await expect(filesTable(page).locator('tbody tr').first()).toContainText('Waiting · 2nd in line');
});

test('what the gateway reported: on the machine, refused with its reason, a backup that failed', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.machines[0].backup_failure = { message: 'CNC not reachable', at: ago(60) };
  state.machines[1].last_report = { id: 52, program_name: 'O5200.nc', delivery_status: 'FAILED', delivery_message: 'CNC memory full', delivered_at: ago(30) };
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(programCard(page)).toContainText('O1234.nc on the machine since');
  await expect(page.getByRole('region', { name: 'Backup from the machine' }).getByRole('alert')).toContainText('Backup failed: CNC not reachable');
  const refused = filesTable(page).locator('tbody tr').filter({ hasText: 'O1000.nc' });
  await expect(refused).toContainText('Refused by machine');
  await expect(refused).toContainText('Program O1000 is running');
  await expect(filesTable(page).locator('tbody tr').filter({ hasText: 'O1234.nc' })).toContainText('On the machine');

  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC-2' });
  await expect(programCard(page).getByRole('alert')).toContainText('The machine could not use O5200.nc: CNC memory full');
});

/* 23 Oct 2026, the user: "upload and backup — are both statuses updated correctly?" Two states the page
   did not show: a program the gateway took but never reported (the line waits behind it), and a backup
   request nobody answered (it just disappeared after 30 minutes). */
test('a program the gateway took says so, flagged when no report comes; a backup nobody answered says so too', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  const m = state.machines[0] as any;
  m.next = { id: 45, program_name: 'O4500.nc', size_bytes: 2048, created_at: ago(900), sent_to_gateway_at: ago(120), report_late: false };
  m.waiting = 2;
  state.files[7] = [fileRow(46, 7, 'O4600.nc', 'NEW', { queue_position: 2 }),
                    fileRow(45, 7, 'O4500.nc', 'NEW', { queue_position: 1, sent_to_gateway_at: ago(120) }), ...state.files[7]];
  m.backup_failure = { message: 'No answer from the gateway within 30 minutes. Check that it is running, then ask again.', at: ago(2400), unanswered: true };
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(programCard(page)).toContainText(/Sent to the gateway at \d{1,2}:\d{2} [AP]M — waiting for its report · 1 more after it/);
  await expect(programCard(page).getByRole('alert')).toHaveCount(0);                 // not late yet
  await expect(filesTable(page).locator('tbody tr').filter({ hasText: 'O4500.nc' })).toContainText('With the gateway');
  await expect(filesTable(page).locator('tbody tr').filter({ hasText: 'O4600.nc' })).toContainText('Waiting · 2nd in line');
  const backup = page.getByRole('region', { name: 'Backup from the machine' });
  await expect(backup.getByRole('alert')).toContainText('Backup not received: No answer from the gateway within 30 minutes. Check that it is running, then ask again.');
  await expect(backup.getByRole('alert')).toContainText('Asked for');
  await expect(backup.getByRole('button', { name: 'Backup now' })).toBeEnabled();

  // ten minutes on and still no report: flagged — the program after it waits
  m.next = { ...m.next, sent_to_gateway_at: ago(900), report_late: true };
  await page.reload();
  await expect(programCard(page).getByRole('alert')).toContainText('No report since then: the programs after it wait until the gateway reports DONE or FAILED.');
});

/* 23 Oct 2026, the user: "show the file path on Program Transfer — and the IP address — to see when one is wrong" */
test('where the gateway sends a machine\'s programs is shown — program path, IP, controller — with the way to put it right', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  Object.assign(state.machines[0], { program_path: '//CNC_MEM/USER/PATH1/', machine_ip: '192.168.1.10', controller_type: 'FANUC' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  const vmc1 = page.getByLabel('Where programs for VMC-1 go');
  await expect(vmc1.getByText('//CNC_MEM/USER/PATH1/', { exact: true })).toBeVisible();
  await expect(vmc1.getByText('192.168.1.10', { exact: true })).toBeVisible();
  await expect(vmc1.getByText('Fanuc', { exact: true })).toBeVisible();
  await expect(vmc1.getByText('Not set')).toHaveCount(0);

  // nothing set for VMC-2: each says so, and the Machines page opens filtered to it
  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC-2' });
  await expect(page.getByLabel('Where programs for VMC-2 go').getByText('Not set', { exact: true })).toHaveCount(3);
  const fix = page.getByRole('link', { name: 'Change on the Machines page' });
  await expect(fix).toHaveAttribute('href', '/machines?search=VMC-2');
});

test('Backup now asks the gateway, and says it is waiting', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  const backup = page.getByRole('button', { name: 'Backup now' });
  await backup.click();
  await expect(page.getByRole('status').filter({ hasText: 'waiting for the gateway' })).toBeVisible();
  await expect(backup).toBeDisabled();
  expect(state.calls.filter(c => c.method === 'POST' && c.path === '/api/programs/machines/7/backup')).toHaveLength(1);
});

test('a file is downloaded; deleting asks in the app first — a waiting upload leaves the line', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.files[7].unshift(fileRow(45, 7, 'O4500.nc', 'NEW', { queue_position: 1 }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  const download = page.waitForEvent('download');
  await filesTable(page).getByRole('button', { name: 'Download O1000.nc' }).click();
  expect((await download).suggestedFilename()).toBe('O1000.nc');

  await filesTable(page).getByRole('button', { name: 'Delete O4500.nc' }).click();
  const waiting = page.getByRole('alertdialog', { name: 'Delete O4500.nc?' });
  await expect(waiting).toContainText("It is taken out of VMC-1's line and never sent to the machine.");
  await waiting.getByRole('button', { name: 'Cancel' }).click();

  await filesTable(page).getByRole('button', { name: 'Delete O1000.nc' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Delete O1000.nc?' });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(state.calls.some(c => c.method === 'DELETE')).toBe(false);
  await filesTable(page).getByRole('button', { name: 'Delete O1000.nc' }).click();
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect(filesTable(page).locator('tbody tr')).toHaveCount(2);
});

test('the company makes no gateway token here: with none yet, the page says S&T sets it up', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.gateway = null;
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(page.getByText('No gateway yet — S&T sets it up')).toBeVisible();
  await expect(page.getByText("Backups come through the company's gateway, which S&T sets up.")).toBeVisible();
  await expect(page.getByRole('button', { name: /gateway token|make token|create token/i })).toHaveCount(0);
  expect(state.calls.some(c => /device-token|program-gateway/.test(c.path))).toBe(false);
  // what S&T hands the gateway team is still served
  const script = await page.request.get('/integrations/mexa-gateway.js');
  expect(script.ok()).toBe(true);
  expect(await script.text()).toContain('function createGateway(');
  expect(await (await page.request.get('/integrations/PROGRAM_TRANSFER_API.md')).text()).toContain('one status call for all of them');
});

test('a view-only role can look and download, nothing more', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user', permissions: ['page:programs:view'] });
  await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(filesTable(page).getByRole('button', { name: 'Download O1000.nc' })).toBeVisible();
  for (const name of ['Upload program', 'Backup now', 'Gateway token', 'Delete O1000.nc']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  // where the button would be, the page says why it is not (22 Oct 2026)
  await expect(page.getByText('Your role cannot upload programs. Your company admin can tick Program Transfer → "Upload to library" and "Send to machine" for your role under Roles & Permissions.')).toBeVisible();
});

test('no Upload button for a company admin whose company was not given it: the page says who can switch it on', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_name: 'S AND T', company_permissions: ['page:programs:view', 'page:programs:fetch'] });
  await fixtures(page);
  await page.goto('/programs');
  await expect(page.getByRole('heading', { name: 'Programs for the machine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload program' })).toHaveCount(0);
  // the company's own name, and the other login that sets a company's access
  await expect(page.getByText('Uploading is not switched on for S AND T. Sign in as the S&T Super Admin → Companies → Manage Access → S AND T → Program Transfer, and tick "Upload to library" and "Send to machine".')).toBeVisible();
});

test('a notification about a file opens that machine with the file marked', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.files[8] = [fileRow(52, 8, 'O5200.nc', 'BACKUP'), fileRow(51, 8, 'O5100.nc', 'NEW', { queue_position: 1 })];
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs?machine_id=8&file_id=51');
  await expect(page.getByLabel('Machine', { exact: true })).toHaveValue(/8/);           // not the first machine
  const row = filesTable(page).locator('tr.is-linked');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('O5100.nc');
  await expect(row).toBeFocused();
  await expect(page).toHaveURL(/\/programs$/);                                       // taken once, dropped from the address
});

test('fits a phone without sideways scrolling', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/programs');
  await expect(page.getByRole('button', { name: 'Upload program' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
