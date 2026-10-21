import type { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Program Transfer, kept simple (21 Oct 2026): choose a machine, upload its
 * program, download files, ask for a backup, give its gateway a token. No
 * company or plant pickers, no FTP/FANUC settings, no queue.
 *
 * Run with its own config: npx playwright test -c playwright.program-transfer.config.ts
 */
const localOrigin = 'http://127.0.0.1:4495';
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const ok = (data: unknown, status = 200) => ({ status, json: { status: 'success', data } });

type Machine = {
  id: number; machine_serial_no: string;
  gateway: { token_prefix: string; token_created_at: string; last_seen_at: string | null; online: boolean } | null;
  program: { id: number; program_name: string; size_bytes: number; created_at: string } | null;
  last_backup: { id: number; program_name: string; created_at: string } | null;
  backup_request: { id: number; requested_at: string } | null;
  backup_failure?: { message: string; at: string } | null;
};
const fileRow = (id: number, machine: number, name: string, kind = 'NEW', current = false, delivery: any = {}) => ({
  id, machine_id: machine, program_name: name, kind, size_bytes: 2048, sha256: 'a'.repeat(64),
  created_at: ago(id), uploaded_by_name: kind === 'NEW' ? 'Ravi' : null, is_current: current,
  delivery_status: null, delivery_message: null, delivered_at: null, ...delivery
});

async function fixtures(page: Page) {
  const state = {
    machines: [
      { id: 7, machine_serial_no: 'VMC-1', gateway: { token_prefix: 'mxd_abcdefgh', token_created_at: ago(86400), last_seen_at: ago(5), online: true },
        program: { id: 40, program_name: 'O1234.nc', size_bytes: 2048, created_at: ago(600), delivery_status: 'DONE', delivery_message: null,
                   delivered_at: ago(500) } as any, last_backup: null, backup_request: null },
      { id: 8, machine_serial_no: 'VMC-2', gateway: null, program: null, last_backup: null, backup_request: null }
    ] as Machine[],
    files: { 7: [fileRow(40, 7, 'O1234.nc', 'NEW', true, { delivery_status: 'DONE', delivered_at: ago(500) }),
                 fileRow(39, 7, 'O1000.nc', 'NEW', false, { delivery_status: 'FAILED', delivery_message: 'Program O1000 is running', delivered_at: ago(900) })],
             8: [] } as Record<number, any[]>,
    calls: [] as { method: string; path: string; query: string }[],
    uploads: [] as string[]
  };
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (!path.startsWith('/api/')) return url.origin === localOrigin ? route.continue() : route.abort();
    state.calls.push({ method, path, query: url.search });
    if (path === '/api/programs/machines') return route.fulfill(ok(state.machines));
    if (path === '/api/programs/files' && method === 'GET') {
      const machine = Number(url.searchParams.get('machine_id')), kind = url.searchParams.get('kind');
      const rows = (state.files[machine] || []).filter(f => !kind || (kind === 'uploads' ? f.kind === 'NEW' : f.kind !== 'NEW'));
      return route.fulfill({ json: { status: 'success', data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } } });
    }
    if (path === '/api/programs/files' && method === 'POST') {
      const body = request.postDataBuffer()?.toString('latin1') || '';
      state.uploads.push(body);
      const m = state.machines.find(x => body.includes(`\r\n\r\n${x.id}\r\n`))!;
      const row = fileRow(41, m.id, 'O3000.nc', 'NEW', true);
      state.files[m.id] = [row, ...state.files[m.id].map(f => ({ ...f, is_current: false }))];
      m.program = { id: 41, program_name: 'O3000.nc', size_bytes: 2048, created_at: ago(0), delivery_status: null, delivery_message: null, delivered_at: null } as any;
      return route.fulfill(ok(row, 201));
    }
    const backup = path.match(/^\/api\/programs\/machines\/(\d+)\/backup$/);
    if (backup) {
      const m = state.machines.find(x => x.id === Number(backup[1]))!;
      m.backup_request = { id: 9, requested_at: ago(0) };
      return route.fulfill(ok({ ...m.backup_request, created: true }, 201));
    }
    const token = path.match(/^\/api\/programs\/machines\/(\d+)\/device-token$/);
    if (token && method === 'POST') {
      const m = state.machines.find(x => x.id === Number(token[1]))!;
      m.gateway = { token_prefix: 'mxd_newtoken', token_created_at: ago(0), last_seen_at: null, online: false };
      return route.fulfill(ok({ token: 'mxd_' + 'Q'.repeat(43), token_prefix: 'mxd_newtoken', created_at: ago(0), machine_serial_no: m.machine_serial_no }, 201));
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

test('only a machine to choose: no company, no plant, no FTP or FANUC settings', async ({ authedPage: page }) => {
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
  await expect(filesTable(page).getByText('Current', { exact: true })).toHaveCount(1);

  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC-2' });
  await expect(page.getByText('No gateway token yet')).toBeVisible();
  await expect(page.getByText('No program uploaded yet.')).toBeVisible();
  expect(state.calls.some(c => c.path === '/api/programs/files' && c.query.includes('machine_id=8'))).toBe(true);
});

test('upload in the dialog makes it the machine\'s program', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Upload program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload program' });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose the program file.');
  await dialog.getByLabel(/Program file/).setInputFiles({ name: 'O3000.nc', mimeType: 'text/plain', buffer: Buffer.from('%\nO3000\nM30\n%\n') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain('name="machine_id"\r\n\r\n7\r\n');
  expect(state.uploads[0]).toContain('filename="O3000.nc"');
  const card = page.getByRole('region', { name: 'Program for the machine' });
  await expect(card).toContainText('O3000.nc');
  await expect(card).toContainText('Waiting for the machine to take it');
  await expect(filesTable(page).locator('tbody tr').first()).toContainText('Current');
  await expect(filesTable(page).locator('tbody tr').first()).toContainText('Waiting');
});

test('what the gateway reported: on the machine, refused with its reason, a backup that failed', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  state.machines[0].backup_failure = { message: 'CNC not reachable', at: ago(60) };
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await expect(page.getByRole('region', { name: 'Program for the machine' })).toContainText('On the machine since');
  await expect(page.getByRole('region', { name: 'Backup from the machine' }).getByRole('alert')).toContainText('Backup failed: CNC not reachable');
  const refused = filesTable(page).locator('tbody tr').filter({ hasText: 'O1000.nc' });
  await expect(refused).toContainText('Refused by machine');
  await expect(refused).toContainText('Program O1000 is running');
  await expect(filesTable(page).locator('tbody tr').filter({ hasText: 'O1234.nc' })).toContainText('On the machine');
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

test('a file is downloaded; deleting asks in the app first', async ({ authedPage: page }) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  const download = page.waitForEvent('download');
  await filesTable(page).getByRole('button', { name: 'Download O1000.nc' }).click();
  expect((await download).suggestedFilename()).toBe('O1000.nc');

  await expect(filesTable(page).getByRole('button', { name: 'Delete O1234.nc' })).toHaveCount(0);   // the machine's program
  await filesTable(page).getByRole('button', { name: 'Delete O1000.nc' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Delete O1000.nc?' });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(state.calls.some(c => c.method === 'DELETE')).toBe(false);
  await filesTable(page).getByRole('button', { name: 'Delete O1000.nc' }).click();
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect(filesTable(page).locator('tbody tr')).toHaveCount(1);
});

test('gateway token: made in a dialog, shown once, with the four calls and the Postman collection', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/programs');
  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC-2' });
  await page.getByRole('button', { name: 'Gateway token' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gateway token — VMC-2' });
  await expect(dialog).toContainText('This machine has no gateway token yet.');
  for (const call of ['/device/v1/status', '/device/v1/program', '/device/v1/backup', '/device/v1/report']) await expect(dialog).toContainText(call);
  await expect(dialog.getByRole('link', { name: 'Postman collection' })).toHaveAttribute('href', '/integrations/MEXA_Program_Transfer.postman_collection.json');
  await dialog.getByRole('button', { name: 'Create token' }).click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('mxd_' + 'Q'.repeat(43));
  await expect(dialog).toContainText('shown only this once');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Gateway has not connected yet')).toBeVisible();
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
});

test('fits a phone without sideways scrolling', async ({ authedPage: page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/programs');
  await expect(page.getByRole('button', { name: 'Upload program' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
