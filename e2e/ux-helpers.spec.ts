import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The shared helpers every dashboard now uses: the (i) beside a figure and
 * the filters folded behind one button on a phone. Tested
 * once here, on the Maintenance Report, rather than on every page.
 */

const ok = (data: any) => ({ status: 'success', data });

const report = ok({
  filters: { from: '2026-08-01', to: '2026-08-31', machine_id: null },
  updated_at: '2026-08-31T10:30:00.000Z',
  kpis: {
    tickets: 12, settled: 9, open: 3, breakdowns: 7, critical: 2,
    downtime_minutes: 540, downtime_unrecorded: 0, mttr_hours: 4.25, mttr_basis: 9,
    mttr_basis_note: 'Mean of 9 resolved tickets', downtime_note: null
  },
  by_machine: [], by_type: { BREAKDOWN: 7, ALARM: 3, INSPECTION: 2, OTHER: 0 },
  by_status: { OPEN: 3, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 4, CLOSED: 5 },
  trend: [], tickets: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
});

async function open(page: any, size = { width: 1366, height: 768 }) {
  const grants = ['page:maintenance-report:view'];
  await seedAuth(page, { roles: ['MAINTENANCE'], user_type: 'MAINTENANCE', permissions: grants, company_permissions: grants });
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { machines: [{ id: 1, machine_serial_no: 'VMC-1' }], shifts: [] } }) }));
  await page.route('**/api/dashboard/maintenance-report*', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(report) }));
  await page.setViewportSize(size);
  await page.goto('/maintenance-report');
  await expect(page.getByRole('heading', { name: 'Maintenance Report' })).toBeVisible();
}

test('the (i) beside MTTR explains it, and gives focus back on Escape', async ({ page }) => {
  await open(page);
  const help = page.getByRole('button', { name: 'What is MTTR (Mean Time To Repair)?' });
  await expect(help).toHaveAttribute('aria-expanded', 'false');

  await help.click();
  const panel = page.getByRole('dialog', { name: 'MTTR (Mean Time To Repair)' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('MTTR = Total repair time ÷ Number of resolved tickets');
  await expect(panel).toContainText('(2 + 3 + 4) ÷ 3 = 3 hours');
  await expect(help).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(help).toBeFocused();

  // and from the keyboard alone
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
});

test('the label keeps its own words: the (i) adds no text to it', async ({ page }) => {
  await open(page);
  await expect(page.locator('.mexa-kpi-label', { hasText: 'Mean Time' })).toHaveText(/^\s*Mean Time\s*to Repair\s*$/);
});

test('on a phone the filters fold behind one button that reads them back', async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  const toggle = page.getByRole('button', { name: /^Show filters/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('From date')).toBeHidden();

  await toggle.click();
  await expect(page.getByRole('button', { name: /^Hide filters/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('From date')).toBeVisible();
});

test('on a laptop the filters stay in the title bar, with no extra button', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /^(Show|Hide) filters/ })).toBeHidden();
  await expect(page.getByLabel('From date')).toBeVisible();
  // the filters apply themselves: no Submit to find
  await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
});
