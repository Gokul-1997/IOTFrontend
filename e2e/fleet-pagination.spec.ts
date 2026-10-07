import { test, expect, seedAuth } from './fixtures/auth';

test('a large fleet uses bounded pages, server totals and recovers a failed page request', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], plant_id: null });
  // No production traffic: all API requests are fixtures, all sockets are closed,
  // and every other nonlocal request is refused.
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { status: 'success', data: [], unread: 0 } });
    if (url.origin !== 'http://127.0.0.1:4493') return route.abort();
    return route.continue();
  });
  const requests: URL[] = [];
  let failPageTwo = true;
  await page.route('**/api/dashboard?*', route => {
    const url = new URL(route.request().url()); requests.push(url);
    const current = Number(url.searchParams.get('page'));
    const size = Number(url.searchParams.get('per_page'));
    expect(url.searchParams.get('paged')).toBe('1');
    expect(size).toBe(6);
    if (current === 2 && failPageTwo) { failPageTwo = false; return route.fulfill({ status: 503, json: { message: 'temporary failure' } }); }
    return route.fulfill({ json: {
      status: 'success', shift: { shift_code: 'DAY', shiftElapsedMinutes: 60, plannedMinutes: 480 },
      summary: { total: 10000, running: 7000, idle: 2000, alarm: 50, offline: 1000 },
      pagination: { page: current, per_page: 6, total: 10000, total_pages: 1667 },
      machines: Array.from({ length: 6 }, (_, i) => ({
        machine_id: (current - 1) * 6 + i + 1, machine_serial_no: `CNC-${(current - 1) * 6 + i + 1}`,
        status: 'RUNNING', alarm: false, run_time: '01:00:00', idle_time: '00:00:00',
        run_minutes: 60, idle_minutes: 0, utilization: 40, target_qty: 100, achieved_qty: 40,
        operator_name: 'Operator', part_name: 'Part', received_at: Math.floor(Date.now() / 1000)
      }))
    } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /Total : 10000/ })).toBeVisible();
  await expect(page.locator('.machine-grid > div')).toHaveCount(6);
  await page.getByRole('button', { name: /Pause page rotation/ }).click();
  await page.getByRole('button', { name: 'Next ›' }).click();
  await expect(page.getByRole('status')).toContainText('retrying automatically');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await expect(page.getByText('CNC-7', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.machine-grid > div')).toHaveCount(6);
  await expect(page.getByText('CNC-1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Running : 7000/ }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('status')).toBe('running');
  expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  await page.screenshot({ path: 'test-results/fleet-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.machine-grid > div')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/fleet-mobile.png', fullPage: true, animations: 'disabled' });
});
