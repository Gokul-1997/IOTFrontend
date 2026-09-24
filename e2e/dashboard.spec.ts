import { test, expect } from './fixtures/auth';

/**
 * Dashboard renders with stubbed API data.
 * We mock /api/dashboard so the test does not need a live backend.
 */

const dashboardResponse = {
  success: true,
  data: {
    shift: { shift_code: 'MS01', shiftElapsedMinutes: 414, plannedMinutes: 720 },
    summary: { total: 3, running: 2, idle: 1 },
    machines: [
      {
        machine_id: 1, machine_serial_no: 'VMC-1-F',
        operator_name: 'OP1', part_name: 'PartA',
        status: 'RUNNING', alarm: false,
        run_minutes: 200, idle_minutes: 50,
        run_time: '03:20:00', idle_time: '00:50:00',
        produced_qty: 12, achieved_qty: 12,
        target_qty: 50, utilization: 24
      },
      {
        machine_id: 2, machine_serial_no: 'VMC-2-F',
        operator_name: 'OP2', part_name: 'PartB',
        status: 'IDLE', alarm: false,
        run_minutes: 0, idle_minutes: 250,
        run_time: '00:00:00', idle_time: '04:10:00',
        produced_qty: 0, achieved_qty: 0,
        target_qty: 30, utilization: 0
      },
      {
        machine_id: 3, machine_serial_no: 'VMC-3-F',
        operator_name: '--', part_name: null,
        status: 'RUNNING', alarm: true,
        run_minutes: 100, idle_minutes: 100,
        run_time: '01:40:00', idle_time: '01:40:00',
        produced_qty: 5, achieved_qty: 5,
        target_qty: 0, utilization: 0
      }
    ]
  }
};

test.describe('Dashboard', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.addInitScript(() => {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      user.permissions = ['page:dashboard', 'page:dashboard:status'];
      localStorage.setItem('user', JSON.stringify(user));
    });
  });
  test('renders the machine summary and original machine cards', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardResponse)
      });
    });

    await page.goto('/dashboard');

    // Total counts
    await expect(page.getByRole('button', { name: /Total 3/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Running 2/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Idle 1/ })).toBeVisible();

    // Machine cards
    await expect(page.getByText('VMC-1-F').first()).toBeVisible();
    await expect(page.getByText('VMC-2-F').first()).toBeVisible();
    await expect(page.getByText('VMC-3-F').first()).toBeVisible();
  });

  test('handles empty machine list', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            shift: { shift_code: 'MS01', shiftElapsedMinutes: 0, plannedMinutes: 720 },
            summary: { total: 0, running: 0, idle: 0 },
            machines: []
          }
        })
      });
    });

    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /Total 0/ })).toBeVisible();
  });
});


test.describe('Original machine card flow', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.addInitScript(() => {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      user.roles = ['COMPANY_ADMIN'];
      localStorage.setItem('user', JSON.stringify(user));
    });
    await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [] } }));
    await page.route('**/api/dashboard?*', route => route.fulfill({ json: dashboardResponse }));
  });

  test('preserves API order, filters by state, and opens the selected machine', async ({ authedPage: page }) => {
    await page.goto('/dashboard');
    const cards = page.locator('.machine-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('VMC-1-F');
    await expect(cards.first()).toContainText('PartA');
    await expect(cards.first()).toContainText('03:20:00');
    await expect(cards.first()).toContainText('00:50:00');
    await page.getByRole('button', { name: /^Alarm 1/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveClass(/alarm/);
    await expect(cards.first()).toContainText('VMC-3-F');
    await cards.first().click();
    await expect(page).toHaveURL(/\/dashboard\/live\/3$/);
  });

  test('shows status counts and complete machine cards on phones', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(page.locator('.machine-card')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Offline 0/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });

  test('keeps prior cards when refresh fails and recovers on retry', async ({ authedPage: page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.machine-card')).toHaveCount(3);
    await page.route('**/api/dashboard?*', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.getByRole('alert')).toContainText('last available readings remain visible');
    await expect(page.locator('.machine-card')).toHaveCount(3);
    await page.route('**/api/dashboard?*', route => route.fulfill({ json: dashboardResponse }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
