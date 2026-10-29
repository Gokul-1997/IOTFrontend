import { test, expect, localFixtureOrigin } from './fixtures/auth';

const meta = { success: true, data: { machines: [], shifts: [
  { id: 1, shift_name: 'Shift 1' }, { id: 2, shift_name: 'Shift 2' }
] } };
const machines = Array.from({ length: 241 }, (_, i) => ({
  machine_id: i + 1, machine_serial_no: `CNC-${String(i + 1).padStart(3, '0')}`, status: 'IDLE',
  availability_pct: 50, performance_pct: 80, quality_pct: 100, oee_pct: 40,
  produced: 10, good: 10, rejected: 0, rework: 0, rejection_rate_pct: 0, idle_seconds: 600
}));
const response = { status: 'success', data: {
  updated_at: '2026-10-28T17:00:00Z', trend: [],
  kpis: { produced: 2410, good: 2410, rejected: 0, oee_pct: 40, availability_pct: 50,
    performance_pct: 80, quality_pct: 100, run_seconds: 144600, idle_seconds: 144600, planned_seconds: 289200 },
  machines: { data: machines, total: machines.length, page: 1, totalPages: 1 }
} };

async function mock(page: any, calls: URL[]) {
  const local = localFixtureOrigin();
  await page.route('**/*', (route: any) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return url.origin === local ? route.continue() : route.abort();
    if (url.pathname === '/api/charts/meta') return route.fulfill({ json: meta });
    if (url.pathname === '/api/dashboard/oee') {
      calls.push(url);
      // Match the API's normal 200-row cap: omitting all_machines recreates the bug.
      const data = url.searchParams.get('all_machines') === 'true' ? machines : machines.slice(0, 200);
      return route.fulfill({ json: { ...response, data: { ...response.data,
        machines: { ...response.data.machines, data } } } });
    }
    return route.fulfill({ json: { success: true, status: 'success', data: [] } });
  });
}

test('OEE dashboard includes machines beyond 200 in its cards and ranking with one request', async ({ authedPage: page }) => {
  const calls: URL[] = [];
  await mock(page, calls);
  await page.goto('/oee-dashboard');
  await expect(page.getByRole('button', { name: 'All 241', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Machine pages' }).getByRole('button', { name: '25', exact: true }).click();
  await expect(page.locator('.mexa-oeecard-name')).toHaveText('CNC-241');
  await page.getByRole('button', { name: 'Bottom 5', exact: true }).click();
  await expect(page.locator('.mexa-oeecard-name').first()).toHaveText('CNC-241');
  expect(calls).toHaveLength(1);
});

test('Machine OEE report retains every row beyond the API default cap', async ({ authedPage: page }) => {
  const calls: URL[] = [];
  await mock(page, calls);
  await page.goto('/reports?tab=machine-oee');
  await expect(page.locator('app-machine-oee-report table')).toContainText('CNC-001');
  const component = page.locator('app-machine-oee-report');
  await component.getByRole('button', { name: 'Machine', exact: true }).click();
  await component.getByRole('button', { name: 'Machine', exact: true }).click();
  await expect(component.locator('tbody').last()).toContainText('CNC-241');
  expect(calls).toHaveLength(1);
  expect(calls[0].searchParams.get('all_machines')).toBe('true');
});

test('OEE failed new filters clear the prior machine cards and totals', async ({ authedPage: page }) => {
  await mock(page, []);
  await page.goto('/oee-dashboard');
  await expect(page.locator('.mexa-oeecard-name').first()).toHaveText('CNC-001');
  await page.route('**/api/dashboard/oee*', route => route.fulfill({ status: 500,
    json: { status: 'error', message: 'Selected shift data is unavailable.' } }));
  await page.locator('#oeShift').selectOption({ label: 'Shift 2' });
  await expect(page.getByRole('alert')).toContainText('Selected shift data is unavailable.');
  await expect(page.locator('.mexa-oeecard')).toHaveCount(0);
  await expect(page.locator('.mexa-kpi')).toHaveCount(0);
});

for (const timezoneId of ['Asia/Kolkata', 'America/Los_Angeles']) {
  test.describe(`machine report dates in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('uses the plant date after midnight', async ({ authedPage: page }) => {
      await page.clock.install({ time: new Date('2026-10-28T00:30:00+05:30') });
      await mock(page, []);
      await page.goto('/reports?tab=machine-oee');
      await expect(page.locator('#moTo')).toHaveValue('2026-10-28');
      await expect(page.locator('#moFrom')).toHaveValue('2026-10-22');
    });
  });
}
