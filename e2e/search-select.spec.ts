import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Machine and operator dropdowns have a search box inside (29 Oct 2026, the
 * user: "all machine dropdowns: search inside, design not changed — the size
 * a little bigger"; then "Operator dropdown also"). The dropdown itself is
 * untouched; the list it opens is shared/search-select.directive.ts.
 *
 * Checked in a title-bar filter (Maintenance Report) and in a form dialog
 * (Maintenance → Create ticket), where Escape must close the list, not the form.
 */

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const MACHINES = [
  ...Array.from({ length: 14 }, (_, i) => ({ id: i + 1, machine_serial_no: `VMC - ${i + 1} - ${i % 2 ? 'M' : 'F'}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: 31 + i, machine_serial_no: `HMC - ${i + 1}` }))
];

const panel = (page: any) => page.locator('.ss-panel');
const chosen = (page: any, sel: string) => page.locator(sel).evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent?.trim());

async function reportPage(page: any, asked: string[]) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/charts/meta', json({ success: true, data: { machines: MACHINES, shifts: [] } }));
  await page.route('**/api/dashboard/maintenance-report*', (r: any) => {
    asked.push(r.request().url());
    return json({ status: 'success', data: { kpis: {}, by_machine: [], by_type: {}, by_status: {}, trend: [], tickets: { data: [], total: 0 } } })(r);
  });
  const grants = ['page:maintenance-report:view'];
  await seedAuth(page, { roles: ['MAINTENANCE'], user_type: 'MAINTENANCE', permissions: grants, company_permissions: grants });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/maintenance-report');
  await expect(page.locator('#mrMachine option')).toHaveCount(MACHINES.length + 1);
}

test('a title-bar machine filter: same look, a search box in its list, and the pick applies', async ({ page }) => {
  const asked: string[] = [];
  await reportPage(page, asked);
  const select = page.locator('#mrMachine');
  const closed = await select.boundingBox();

  await select.click();
  await expect(panel(page)).toBeVisible();
  const search = panel(page).getByRole('combobox', { name: 'Search Machine' });
  await expect(search).toBeFocused();
  expect(await select.boundingBox()).toEqual(closed);              // the dropdown itself did not change
  const box = (await panel(page).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(240);                   // a little roomier than the small filter
  expect(box.y).toBeGreaterThanOrEqual(closed!.y + closed!.height);
  await page.screenshot({ path: 'test-results/search-select-open.png', clip: { x: 0, y: 0, width: 1440, height: 560 } });

  await search.fill('vmc1');
  await expect(panel(page).getByRole('option')).toHaveText(['VMC - 1 - F', 'VMC - 10 - M', 'VMC - 11 - F', 'VMC - 12 - M', 'VMC - 13 - F', 'VMC - 14 - M']);
  await search.fill('vmc 12');
  await expect(panel(page).getByRole('option')).toHaveText(['VMC - 12 - M']);
  await page.screenshot({ path: 'test-results/search-select-typed.png', clip: { x: 0, y: 0, width: 1440, height: 560 } });
  const before = asked.length;
  await panel(page).getByRole('option', { name: 'VMC - 12 - M' }).click();

  await expect(panel(page)).toHaveCount(0);
  await expect(select).toBeFocused();
  expect(await chosen(page, '#mrMachine')).toBe('VMC - 12 - M');
  await expect.poll(() => asked.slice(before).some(u => /machine_id=12\b/.test(u))).toBe(true);

  // from the keyboard: typing on the dropdown searches; Enter picks; Escape leaves it as it was
  await select.press('h');
  await expect(search).toHaveValue('h');
  await page.keyboard.type('mc5');
  await page.keyboard.press('Enter');
  expect(await chosen(page, '#mrMachine')).toBe('HMC - 5');
  await select.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  expect(await chosen(page, '#mrMachine')).toBe('HMC - 5');

  // dark theme: the list takes the card's colours
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await select.click();
  await panel(page).getByRole('combobox').fill('vmc');
  const look = await panel(page).evaluate((p: HTMLElement) => getComputedStyle(p).backgroundColor);
  expect(look).toBe('rgb(3, 23, 53)');
  await page.screenshot({ path: 'test-results/search-select-dark.png', clip: { x: 0, y: 0, width: 1440, height: 560 } });
  await page.mouse.click(1300, 800);                               // a click elsewhere closes it
  await expect(panel(page)).toHaveCount(0);
});

test('in a form dialog: the list sits over it, Escape closes the list and not the form, and the pick is saved', async ({ authedPage: page }) => {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/master/machines**', json({ success: true, data: MACHINES }));
  await page.route('**/api/tickets/assignees', json({ success: true, data: [{ id: 3, username: 'ravi' }] }));
  const sent: any[] = [];
  await page.route(/\/api\/tickets(\?.*)?$/, (r: any) => {
    if (r.request().method() === 'POST') { sent.push(r.request().postDataJSON()); return json({ success: true, data: { id: 1 } }, 201)(r); }
    return json({ success: true, data: [] })(r);
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/maintenance');
  await page.getByRole('button', { name: '+ Create ticket' }).click();
  const form = page.getByRole('dialog', { name: 'Create maintenance ticket' });
  const machine = form.getByLabel('Machine');

  await machine.click();
  await expect(panel(page)).toBeVisible();
  const option = panel(page).getByRole('option', { name: 'HMC - 2' });
  await option.click({ trial: true });                              // nothing on top of it: the dialog is under the list
  await page.screenshot({ path: 'test-results/search-select-dialog.png' });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(machine).toBeFocused();

  await machine.click();
  await page.keyboard.type('hmc2');
  await page.keyboard.press('Enter');
  expect(await chosen(page, '#tk-machine')).toBe('HMC - 2');
  await form.getByLabel('Title').fill('Coolant leak');
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(form).toHaveCount(0);
  expect(sent).toEqual([expect.objectContaining({ machine_id: 32, title: 'Coolant leak' })]);
});
