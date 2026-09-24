import { test, expect, seedAuth } from './fixtures/auth';

/**
 * Dashboard renders with stubbed API data.
 * We mock /api/dashboard so the test does not need a live backend.
 */

/* The list endpoint answers with its fields at the top level
   ({ status, shift, summary, machines }) — dashboard.controller.js spreads
   them into the body. This fixture used to nest them under `data`, which the
   page never reads, so both tests here saw an empty dashboard. */
const dashboardResponse = {
  status: 'success',
  ...{
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
  test('renders the machine summary and per-machine cards', async ({ authedPage: page }) => {
    await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardResponse)
      });
    });

    await page.goto('/dashboard');

    // the counters (shown with the dashboard "status" widget, which a company
    // admin holds); VMC-3-F is running with its alarm on, so it counts in both
    await expect(page.getByRole('button', { name: /Total : 3/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Running : 2/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Idle : 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alarm : 1/ })).toBeVisible();

    // Machine cards
    await expect(page.getByText('VMC-1-F').first()).toBeVisible();
    await expect(page.getByText('VMC-2-F').first()).toBeVisible();
    await expect(page.getByText('VMC-3-F').first()).toBeVisible();
  });

  test('handles empty machine list', async ({ authedPage: page }) => {
    await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          shift: { shift_code: 'MS01', shiftElapsedMinutes: 0, plannedMinutes: 720 },
          summary: { total: 0, running: 0, idle: 0 },
          machines: []
        })
      });
    });

    await page.goto('/dashboard');
    await expect(page.getByText('MS01')).toBeVisible();          // the response was applied
    await expect(page.getByRole('button', { name: /Total : 0/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alarm : 0/ })).toBeVisible();
  });
});
