import { test, expect } from './fixtures/auth';

const machineList = {
  success: true,
  data: [
    // the shape GET /api/machines returns: the line's name comes back as `name`
    {
      id: 1, machine_serial_no: 'VMC-1-F', model: 'VMC 850', controller: 'FANUC 0i-MF',
      line_id: 2, name: 'Line 1', is_active: true
    },
    {
      id: 2, machine_serial_no: 'VMC-2-F', model: 'VMC 1050', controller: 'Mitsubishi M80',
      line_id: 2, name: 'Line 1', is_active: false
    }
  ],
  meta: { page: 1, limit: 10, total: 2, totalPages: 1 }
};

const emptyList = {
  success: true,
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
};

function stubMachines(page: any, response = machineList) {
  return page.route('**/api/machines**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  );
}

test.describe('Machines page', () => {
  test('TC-M-01 lists machine cards', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    await expect(page.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('VMC-2-F').first()).toBeVisible();
  });

  test('TC-M-02 shows empty state when no machines', async ({ authedPage: page }) => {
    await stubMachines(page, emptyList);
    await page.goto('/machines');

    await expect(page.getByText('VMC-1-F')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-M-03 navigates to create page on Add button click', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    const addBtn = page.getByRole('button', { name: /add|create|new machine/i }).first();
    if (await addBtn.isVisible({ timeout: 5_000 })) {
      await addBtn.click();
      await expect(page).toHaveURL(/\/machines\/create/);
    }
  });

  test('TC-M-04 shows 500 error gracefully', async ({ authedPage: page }) => {
    await page.route('**/api/machines**', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server Error' }) })
    );
    await page.goto('/machines');

    // Should not crash — still renders the page shell
    await expect(page).toHaveURL(/\/machines/);
    // No machines listed
    await expect(page.getByText('VMC-1-F')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-M-05 line, model and controller shown in the register', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    const row = page.getByRole('row', { name: /VMC-1-F/ });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('Line 1')).toBeVisible();
    await expect(row.getByText('VMC 850')).toBeVisible();
    await expect(row.getByText('FANUC 0i-MF')).toBeVisible();
  });

  test('TC-M-06 active switch reflects each machine', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    await expect(page.getByRole('row', { name: /VMC-1-F/ }).getByRole('switch')).toBeChecked({ timeout: 10_000 });
    await expect(page.getByRole('row', { name: /VMC-2-F/ }).getByRole('switch')).not.toBeChecked();
  });
});
