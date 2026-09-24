import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Break times on a shift (Master → Shifts → Edit): when each break happens,
 * for the machine page's shift timeline. Saved with the shift, after it, so
 * the breaks are checked against the shift's saved hours.
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const SHIFT = { id: 5, shift_code: 'Shift 1', shift_name: 'Morning', start_time: '08:00:00', end_time: '20:00:00', break_minutes: 45, is_active: true };

async function openEdit(page: any, breaks: any = { status: 'success', data: [] }, breaksStatus = 200) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/shifts', (r: any) => r.fulfill(ok({ status: 'success', data: [SHIFT] })));
  await page.route('**/api/shifts/5/breaks', (r: any) => r.request().method() === 'GET'
    ? r.fulfill({ status: breaksStatus, contentType: 'application/json', body: JSON.stringify(breaks) })
    : r.fallback());
  await page.goto('/shifts');
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Edit Shift' })).toBeVisible();
}

test('adds break times and saves them with the shift', async ({ authedPage: page }) => {
  let sent: any = null;
  await openEdit(page);
  await page.route('**/api/shifts/5/breaks', (r: any) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    sent = JSON.parse(r.request().postData() || '{}');
    return r.fulfill(ok({ status: 'success', data: sent.breaks }));
  });

  const dlg = page.getByRole('dialog', { name: 'Edit Shift' });
  await expect(dlg.getByText('No break times yet.')).toBeVisible();
  await dlg.getByRole('button', { name: '+ Add break' }).click();
  await expect(dlg.locator('#brkName0')).toBeFocused();
  await dlg.locator('#brkName0').fill('Tea Break');
  await dlg.locator('#brkFrom0').fill('11:00');
  await dlg.locator('#brkTo0').fill('11:15');
  await dlg.getByRole('button', { name: '+ Add break' }).click();
  await dlg.locator('#brkName1').fill('Lunch');
  await dlg.locator('#brkFrom1').fill('13:00');
  await dlg.locator('#brkTo1').fill('13:30');
  await expect(dlg.getByText('These add up to 45 min.')).toBeVisible();

  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toHaveCount(0);
  expect(sent).toEqual({ breaks: [
    { break_name: 'Tea Break', start_time: '11:00', end_time: '11:15' },
    { break_name: 'Lunch', start_time: '13:00', end_time: '13:30' }
  ] });
});

test('a break with no name is stopped before anything is sent', async ({ authedPage: page }) => {
  let puts = 0;
  await openEdit(page);
  await page.route('**/api/shifts/5/breaks', (r: any) => { if (r.request().method() === 'PUT') puts++; return r.fallback(); });
  const dlg = page.getByRole('dialog', { name: 'Edit Shift' });
  await dlg.getByRole('button', { name: '+ Add break' }).click();
  await dlg.locator('#brkFrom0').fill('11:00');
  await dlg.locator('#brkTo0').fill('11:15');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('Break 1 needs a name.');
  expect(puts).toBe(0);
});

test('the server\'s reason is shown in place when it refuses the list', async ({ authedPage: page }) => {
  await openEdit(page, { status: 'success', data: [{ id: 1, break_name: 'Tea', start_time: '11:00', end_time: '11:15', minutes: 15 }] });
  await page.route('**/api/shifts/5/breaks', (r: any) => r.request().method() === 'PUT'
    ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'Late must fall inside the shift (08:00–20:00)' }) })
    : r.fallback());
  const dlg = page.getByRole('dialog', { name: 'Edit Shift' });
  await expect(dlg.locator('#brkName0')).toHaveValue('Tea');
  await dlg.getByRole('button', { name: '+ Add break' }).click();
  await dlg.locator('#brkName1').fill('Late');
  await dlg.locator('#brkFrom1').fill('19:45');
  await dlg.locator('#brkTo1').fill('20:15');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('Late must fall inside the shift (08:00–20:00)');
  await expect(dlg).toBeVisible();   // kept open to fix
});

test('removing a break is announced by name', async ({ authedPage: page }) => {
  await openEdit(page, { status: 'success', data: [{ id: 1, break_name: 'Tea', start_time: '11:00', end_time: '11:15', minutes: 15 }] });
  const dlg = page.getByRole('dialog', { name: 'Edit Shift' });
  await dlg.getByRole('button', { name: 'Remove Tea' }).click();
  await expect(dlg.getByText('No break times yet.')).toBeVisible();
});

test('before database update 028, it says so instead of failing', async ({ authedPage: page }) => {
  await openEdit(page, { status: 'error', message: 'not set up' }, 503);
  const dlg = page.getByRole('dialog', { name: 'Edit Shift' });
  await expect(dlg.getByText('Break times are not set up on this server yet (database update 028 is pending).')).toBeVisible();
  await expect(dlg.getByRole('button', { name: '+ Add break' })).toHaveCount(0);
});

test('a new shift is told to add breaks after it is created', async ({ authedPage: page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.goto('/shifts');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('dialog', { name: 'Create Shift' })
    .getByText('Create the shift first, then open it again to add its break times.')).toBeVisible();
});
