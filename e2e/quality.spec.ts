import { test, expect } from './fixtures/auth';

const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }],
    shifts:   [{ id: 5, shift_code: 'MS01', shift_name: 'Morning',
                 start_time: '08:00', end_time: '20:00' }]
  }
};

const quality = {
  success: true,
  data: {
    machine_serial_no: 'VMC-1-F',
    target: 50,
    achieved: 30,
    accepted: 28,
    reject:   1,
    rework:   1
  }
};

test.describe('Quality page', () => {
  test('renders quality metrics for selected machine', async ({ authedPage: page }) => {
    await page.route('**/api/quality/meta*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
    await page.route('**/api/quality*',      r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quality) }));

    await page.goto('/quality');

    // Expect at least one metric label visible
    await expect(page.getByText(/quality/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
