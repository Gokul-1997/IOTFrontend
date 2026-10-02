import { test, expect } from './fixtures/auth';

const shiftList = {
  success: true,
  data: [
    {
      id: 1, shift_code: 'MS01', shift_name: 'Morning',
      start_time: '08:00', end_time: '20:00', break_minutes: 30, is_active: true
    },
    {
      id: 2, shift_code: 'NS01', shift_name: 'Night',
      start_time: '20:00', end_time: '08:00', break_minutes: 60, is_active: true
    }
  ],
  meta: { page: 1, limit: 10, total: 2, totalPages: 1 }
};

const emptyList = {
  success: true,
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
};

function stubShifts(page: any, response = shiftList) {
  return page.route('**/api/shifts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  );
}

test.describe('Shifts page', () => {
  test('TC-SH-01 lists shift names', async ({ authedPage: page }) => {
    await stubShifts(page);
    await page.goto('/shifts');

    await expect(page.getByText('Morning').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Night').first()).toBeVisible();
  });

  test('TC-SH-02 shows shift codes', async ({ authedPage: page }) => {
    await stubShifts(page);
    await page.goto('/shifts');

    await expect(page.getByText('MS01').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('NS01').first()).toBeVisible();
  });

  test('TC-SH-03 shows shift times', async ({ authedPage: page }) => {
    await stubShifts(page);
    await page.goto('/shifts');

    // shown in 12-hour form: Morning 08:00 AM – 08:00 PM, Night the other way round
    await expect(page.getByText(/08:00 AM\s*–\s*08:00 PM/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/08:00 PM\s*–\s*08:00 AM/).first()).toBeVisible();
  });

  test('TC-SH-04 empty state renders without crash', async ({ authedPage: page }) => {
    await stubShifts(page, emptyList);
    await page.goto('/shifts');

    await expect(page.getByText('Morning')).toHaveCount(0, { timeout: 10_000 });
  });

  /* Add opens the Create Shift form as a dialog on this page. The old test
     expected a /shifts/create page and only checked it when isVisible() —
     which does not wait — happened to find the button already drawn, so it
     passed when it checked nothing and failed when it checked. */
  test('TC-SH-05 Add opens the Create Shift form', async ({ authedPage: page }) => {
    await stubShifts(page);
    await page.goto('/shifts');

    await page.getByRole('button', { name: 'New Shift' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Shift' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/shifts$/);
  });

  test('TC-SH-06 handles 500 server error without crashing', async ({ authedPage: page }) => {
    await page.route('**/api/shifts*', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    );
    await page.goto('/shifts');

    await expect(page).toHaveURL(/\/shifts/);
    await expect(page.getByText('Morning')).toHaveCount(0, { timeout: 10_000 });
  });
});
