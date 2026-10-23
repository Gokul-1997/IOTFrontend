import { test, expect } from './fixtures/auth';

const machineList = {
  success: true,
  data: [
    // the shape GET /api/machines returns: the line's name comes back as `name`
    {
      id: 1, machine_serial_no: 'VMC-1-F', model: 'VMC 850', controller: 'FANUC 0i-MF', controller_type: 'FANUC',
      controller_ip: '192.168.1.10', ip_address: '192.168.1.99', line_id: 2, name: 'Line 1', is_active: true
    },
    {
      id: 2, machine_serial_no: 'VMC-2-F', model: 'VMC 1050', controller: 'Mitsubishi M80', ip_address: '192.168.1.20',
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

  /* Add opens the machine form as a dialog on this page (there is no
     /machines/create page); isVisible() does not wait, so the old version
     checked nothing whenever the list had not drawn yet. */
  test('TC-M-03 Add opens the machine form', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    await page.getByRole('button', { name: 'New Machine' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/machines$/);
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
    await expect(row.getByText('Fanuc · FANUC 0i-MF')).toBeVisible();    // the controller type chosen, then the Controller text
    // a machine with no type chosen shows its Controller text alone
    await expect(page.getByRole('row', { name: /VMC-2-F/ }).getByText('Mitsubishi M80', { exact: true })).toBeVisible();
  });

  // Program Transfer's "Change on the Machines page" opens the list on that machine
  test('TC-M-05c opened for one machine: the list starts filtered to it', async ({ authedPage: page }) => {
    const searched: string[] = [];
    await page.route('**/api/machines**', (r: any) => {
      searched.push(new URL(r.request().url()).searchParams.get('search') ?? '');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machineList) });
    });
    await page.goto('/machines?search=VMC-1-F');
    await expect(page.getByPlaceholder('Search serial, model, line…')).toHaveValue('VMC-1-F');
    await expect.poll(() => searched[0]).toBe('VMC-1-F');
  });

  // 23 Oct 2026, the user: "machine page — where is the machine IP?"
  test('TC-M-05b the IP the gateway gets: the machine\'s own report first, else the one typed on the form', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await stubMachines(page);
    await page.goto('/machines');
    const reported = page.getByRole('row', { name: /VMC-1-F/ }).getByText('192.168.1.10', { exact: true });
    await expect(reported).toBeVisible({ timeout: 10_000 });
    await expect(reported).toHaveAttribute('title', 'Reported by the machine');
    const typed = page.getByRole('row', { name: /VMC-2-F/ }).getByText('192.168.1.20', { exact: true });
    await expect(typed).toHaveAttribute('title', 'Typed on the machine form');
  });

  test('TC-M-06 active switch reflects each machine', async ({ authedPage: page }) => {
    await stubMachines(page);
    await page.goto('/machines');

    await expect(page.getByRole('row', { name: /VMC-1-F/ }).getByRole('switch')).toBeChecked({ timeout: 10_000 });
    await expect(page.getByRole('row', { name: /VMC-2-F/ }).getByRole('switch')).not.toBeChecked();
  });
});
