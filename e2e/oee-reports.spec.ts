import { test, expect, seedAuth } from './fixtures/auth';

const asCompanyAdmin = (page: any) => seedAuth(page, { roles: ['COMPANY_ADMIN'] });

const oeeMeta = {
  success: true,
  data: {
    lines:    [{ id: 1, name: 'Line A' }],
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F', line_id: 1, line_name: 'Line A' }],
    shifts:   [{ id: 5, shift_code: 'MS01', shift_name: 'Morning',
                 start_time: '08:00', end_time: '20:00' }]
  }
};

const oeeReports = {
  success: true,
  data: [
    {
      shift_date: '2026-04-26T18:30:00.000Z',
      machine_id: 1, machine_serial_no: 'VMC-1-F',
      shift_code: 'MS01', shift_name: 'Morning',
      operator_name: 'OP1',
      oee: '74.10', availability: '100.00', performance: '74.10', quality: '100.00'
    }
  ],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  filters: {}
};

// OEE Reports is the OEE Records tab of Reports; /oee-reports redirects there
test.describe('Reports → OEE Records', () => {
  test('renders rows with availability/performance/quality/oee columns', async ({ authedPage: page }) => {
    await asCompanyAdmin(page);
    await page.route('**/api/oee/meta*',    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeMeta) }));
    await page.route('**/api/oee/reports*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeReports) }));

    await page.goto('/oee-reports');
    await expect(page).toHaveURL(/\/reports\?tab=oee-records$/);

    // the machine filter's <option> also says VMC-1-F; look in the results
    const rows = page.locator('table.data-table tbody');
    await expect(rows.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
    await expect(rows.getByText('74.10').first()).toBeVisible();
    await expect(rows.getByText('100.00').first()).toBeVisible();
  });

  test('shows empty state for date range with no data', async ({ authedPage: page }) => {
    await asCompanyAdmin(page);
    await page.route('**/api/oee/meta*',    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeMeta) }));
    await page.route('**/api/oee/reports*', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }, filters: {}
      })
    }));

    await page.goto('/reports?tab=oee-records');
    // Scope to the results table: the machine name also appears in the
    // filter dropdown, so a page-wide check would match that instead.
    await expect(page.locator('table.data-table tbody').getByText('VMC-1-F')).toHaveCount(0);
    await expect(page.getByText(/No records found/i)).toBeVisible();
  });
});

/* Opened on an OEE tab (the old /oee-reports link does that), the page had
   not fetched the production filters' machine / shift / operator lists, so
   switching to Production left the filters empty. */
test('switching from OEE Records to Production fills the filters', async ({ authedPage: page }) => {
  await asCompanyAdmin(page);
  const list = (data: any[]) => (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data }) });
  await page.route('**/api/**', list([]));
  await page.route('**/api/oee/meta*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeMeta) }));
  await page.route('**/api/reports/machines*', list([{ id: 1, name: 'CNC-01' }]));
  await page.route('**/api/reports/shifts*', list([{ id: 10, name: 'Shift 1' }]));
  await page.route('**/api/reports/production-data*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { rows: [], summary: {} } }) }));

  await page.goto('/oee-reports');
  await expect(page.getByRole('tab', { name: /OEE Records/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Production/ }).click();
  await expect(page.locator('select').filter({ has: page.locator('option', { hasText: 'CNC-01' }) })).toHaveCount(1);
  await expect(page.locator('select').filter({ has: page.locator('option', { hasText: 'Shift 1' }) })).toHaveCount(1);
});
