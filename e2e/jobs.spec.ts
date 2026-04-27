import { test, expect } from './fixtures/auth';

const machines = { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F' }] };

const jobList = {
  success: true,
  data: [
    {
      id: 1, machine_id: 1, machine_serial_no: 'VMC-1-F',
      part_name: 'PartA', target_qty: 50,
      started_at: '2026-04-27T08:00:00Z',
      is_active: true
    }
  ],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
};

test.describe('Job page', () => {
  test('shows active jobs and stop button', async ({ authedPage: page }) => {
    await page.route('**/api/machines*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) }));
    await page.route('**/api/jobs*',     r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobList) }));

    await page.goto('/job');

    await expect(page.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('PartA').first()).toBeVisible();
  });
});
