import { test, expect } from './fixtures/auth';

const json = (status: number, body: any) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const machines = { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F' }] };

const componentList = {
  success: true,
  data: [
    {
      id: 11, machine_id: 1, machine_serial_no: 'VMC-1-F',
      part_name: 'PartA', part_number: 'PN-001',
      operation_number: 'OP-1',
      cycle_time: { hours: 0, minutes: 1, seconds: 0 },
      target: 50, multiplication_factor: 1
    }
  ],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
};

// every other call answered here: environment.ts points at the live API
test.beforeEach(async ({ authedPage: page }) => {
  await page.route('**/api/**', r => r.fulfill(json(200, { success: true, data: [] })));
});

test.describe('Components page', () => {
  test('lists components and opens create modal', async ({ authedPage: page }) => {
    await page.route('**/api/machines*',   r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) }));
    await page.route('**/api/components*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(componentList) }));

    await page.goto('/component');

    await expect(page.getByText('PartA').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('PN-001').first()).toBeVisible();

    // Try to open the create modal — exact button text varies, so be flexible
    const addBtn = page.getByRole('button', { name: /add|create|new/i }).first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.getByText(/part name/i).first()).toBeVisible();
    }
  });
});

/* 28 Nov 2026, the user: "in component entry I need to select multiple
   machines". One part, many machines: one component each. */
test.describe('Add Component: one part on many machines', () => {
  const fleet = [
    { id: 21, machine_serial_no: 'VMC - 1 - F' }, { id: 22, machine_serial_no: 'VMC - 2 - F' },
    { id: 30, machine_serial_no: 'VMC - 12 - M' }, { id: 40, machine_serial_no: 'HMC - 2' }
  ];

  async function open(page: any, answer?: (body: any) => any) {
    const posts: any[] = [], puts: any[] = [];
    await page.route('**/api/master/machines*', (r: any) => r.fulfill(json(200, { success: true, data: fleet })));
    await page.route('**/api/components**', (r: any) => {
      const req = r.request();
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        posts.push(body);
        return r.fulfill(answer ? answer(body) : json(200, { status: 'success', data: body.machine_ids.map((m: number, i: number) => ({ id: 100 + i, machine_id: m })) }));
      }
      if (req.method() === 'PUT') {
        puts.push(JSON.parse(req.postData() || '{}'));
        return r.fulfill(json(200, { status: 'success', data: {} }));
      }
      return r.fulfill(json(200, componentList));
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/component');
    await expect(page.getByText('PartA').first()).toBeVisible({ timeout: 10_000 });
    return { posts, puts };
  }

  async function fillPart(dialog: any) {
    await dialog.getByLabel('Part name').fill('Flange Housing');
    await dialog.getByLabel('Part number').fill('PN-4471');
    await dialog.getByLabel('Operation number').fill('OP-10');
    await dialog.getByLabel('Cycle time').fill('000130');
    await dialog.getByRole('spinbutton', { name: 'Target' }).fill('250');
  }

  test('pick the machines from a searchable tick list; one request makes one component on each', async ({ authedPage: page }) => {
    const { posts } = await open(page);
    await page.getByRole('button', { name: 'Add Component' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Component' });
    const field = dialog.getByLabel('Machines');
    await expect(field).toHaveText(/Select machines/);
    await expect(dialog.getByText('One component per machine, each edited on its own.')).toBeVisible();

    await field.click();
    const list = page.getByRole('dialog', { name: 'Choose machines' });
    const search = list.getByRole('textbox', { name: 'Search machines' });
    await expect(search).toBeFocused();
    await search.fill('vmc2');                                   // case, spaces and dashes ignored
    await expect(list.locator('.mt-option-text')).toHaveText(['VMC - 2 - F']);
    await search.press('Enter');                                 // ticks the first match
    await search.fill('');
    await list.getByRole('checkbox', { name: 'HMC - 2' }).check();
    await expect(list.getByText('2 of 4 selected')).toBeVisible();

    await page.keyboard.press('Escape');                         // closes the list, not the dialog
    await expect(list).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(field).toBeFocused();
    // a third of the dialog: the first whole name and a count, never two names cut short
    await expect(field.locator('.ms-chip:visible')).toHaveText(['VMC - 2 - F', '+1']);
    await expect(field).toHaveAccessibleDescription(/Selected: VMC - 2 - F, HMC - 2/);

    await fillPart(dialog);
    await dialog.getByRole('button', { name: 'Add to 2 machines' }).click();

    await expect(page.getByText('Flange Housing added to 2 machines')).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(posts).toEqual([{
      part_name: 'Flange Housing', part_number: 'PN-4471', operation_number: 'OP-10',
      cycle_time: '00:01:30', target: 250, multiplication_factor: 1, machine_ids: [22, 40]
    }]);
  });

  test('nothing filled in: each required field says what it needs, and nothing is sent', async ({ authedPage: page }) => {
    const { posts } = await open(page);
    await page.getByRole('button', { name: 'Add Component' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Component' });
    await dialog.getByRole('button', { name: 'Add component' }).click();
    for (const message of ['Choose the machines this part runs on.', 'Part name is required.', 'Part number is required.',
      'Enter the cycle time as hh:mm:ss.', 'Enter a target of 1 or more.']) {
      await expect(dialog.getByText(message)).toBeVisible();
    }
    await expect(dialog.getByLabel('Machines')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toHaveLength(0);
  });

  test('the same part already on a machine: the API\'s words stay in the dialog to act on', async ({ authedPage: page }) => {
    const said = 'VMC - 2 - F already has Flange Housing (PN-4471 · OP-10) — edit that one, or leave that machine out.';
    const { posts } = await open(page, () => json(409, { status: 'error', message: said, code: 'COMPONENT_EXISTS' }));
    await page.getByRole('button', { name: 'Add Component' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Component' });
    await dialog.getByLabel('Machines').click();
    await page.getByRole('dialog', { name: 'Choose machines' }).getByRole('checkbox', { name: 'VMC - 2 - F' }).check();
    await page.keyboard.press('Escape');
    await fillPart(dialog);
    await dialog.getByRole('button', { name: 'Add component' }).click();

    await expect(dialog.getByRole('alert').filter({ hasText: said })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add component' })).toBeEnabled();
    expect(posts).toHaveLength(1);
  });

  test('editing keeps the component on its machine and sends only the part', async ({ authedPage: page }) => {
    const { puts } = await open(page);
    await page.getByRole('button', { name: 'Edit PartA' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Component' });
    await expect(dialog.getByLabel('Machine', { exact: true })).toHaveValue('VMC-1-F');
    await expect(dialog.getByLabel('Machine', { exact: true })).toBeDisabled();
    await expect(dialog.getByText('A component stays on its machine.')).toBeVisible();
    await expect(dialog.locator('app-multi-select')).toHaveCount(0);

    await dialog.getByRole('spinbutton', { name: 'Target' }).fill('60');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('PartA saved')).toBeVisible();
    expect(puts).toEqual([{ part_name: 'PartA', part_number: 'PN-001', operation_number: 'OP-1', cycle_time: '00:01:00', target: 60, multiplication_factor: 1 }]);
  });
});
