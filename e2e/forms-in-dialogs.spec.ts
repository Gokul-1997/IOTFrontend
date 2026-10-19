import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Every form opens in the same dialog the master pages (Machines, Plants,
 * Shifts…) already used: title and × at the top, the fields, Cancel and Save
 * at the foot (19 Oct 2026, "all page same … same flow"). Downtime,
 * Maintenance, Tariff & Rates, My Profile and Quality opened their forms in
 * the page instead; the browser's confirm() boxes are the app's own dialog
 * now too.
 */

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubApi(page: any) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
}

const dialog = (page: any, name: string) => page.getByRole('dialog', { name });

test('Downtime: Add reason code opens the dialog, checks what is missing, says why a save failed, and saves', async ({ authedPage: page }) => {
  await stubApi(page);
  const posted: any[] = [];
  await page.route('**/api/downtime/reasons', (r: any) => {
    if (r.request().method() !== 'POST') {
      return json({ success: true, data: [{ id: 1, code: 'BRK', name: 'Breakdown', category: 'UNPLANNED', company_id: null }] })(r);
    }
    posted.push(r.request().postDataJSON());
    return posted.length === 1
      ? json({ success: false, message: 'Reason code COOL already exists' }, 409)(r)
      : json({ success: true, data: { id: 9 } }, 201)(r);
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/downtime');
  await page.getByRole('tab', { name: 'Reason codes' }).click();

  const add = page.getByRole('button', { name: '+ Add reason code' });
  await add.click();
  const d = dialog(page, 'Add reason code');
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Code')).toBeFocused();

  // Escape is Cancel, and focus goes back to the button that opened it
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(add).toBeFocused();

  await add.click();
  await d.getByRole('button', { name: 'Add reason code' }).click();
  await expect(d.getByText('Enter a code.')).toBeVisible();
  await expect(d.getByText('Enter a name.')).toBeVisible();
  expect(posted).toHaveLength(0);

  await d.getByLabel('Code').fill('cool');
  await d.getByLabel('Name').fill('Coolant top-up');
  await d.getByLabel('Category').selectOption('PLANNED');
  await d.getByRole('button', { name: 'Add reason code' }).click();
  await expect(d.getByText('Reason code COOL already exists')).toBeVisible();   // kept open, typed values kept
  await expect(d.getByText('Enter a code.')).toHaveCount(0);
  await expect(d.getByLabel('Name')).toHaveValue('Coolant top-up');

  await d.getByLabel('Code').fill('COOL2');
  await d.getByRole('button', { name: 'Add reason code' }).click();
  await expect(d).toHaveCount(0);
  expect(posted[1]).toEqual({ code: 'COOL2', name: 'Coolant top-up', category: 'PLANNED' });
});

test('Maintenance: tickets, schedules and logs are added in the dialog; removing a schedule asks in the app', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.route('**/api/master/machines**', json({ success: true, data: [{ id: 7, machine_serial_no: 'VMC-7' }] }));
  await page.route('**/api/tickets/assignees', json({ success: true, data: [{ id: 3, username: 'ravi' }] }));
  const sent: Record<string, any[]> = { ticket: [], schedule: [], log: [], removed: [] };
  await page.route(/\/api\/tickets(\?.*)?$/, (r: any) => {
    if (r.request().method() === 'POST') { sent['ticket'].push(r.request().postDataJSON()); return json({ success: true, data: { id: 1 } }, 201)(r); }
    return json({ success: true, data: [] })(r);
  });
  await page.route(/\/api\/maintenance\/schedules(\?.*)?$/, (r: any) => {
    if (r.request().method() === 'POST') { sent['schedule'].push(r.request().postDataJSON()); return json({ success: true, data: { id: 12 } }, 201)(r); }
    return json({ success: true, data: [{ id: 11, machine_serial_no: 'VMC-7', title: 'Spindle check', maintenance_type: 'PREVENTIVE',
                                          scheduled_at: '2026-10-25T04:30:00Z', status: 'SCHEDULED' }] })(r);
  });
  await page.route(/\/api\/maintenance\/schedules\/\d+$/, (r: any) => { sent['removed'].push(r.request().url()); return json({ success: true })(r); });
  await page.route(/\/api\/maintenance\/logs(\?.*)?$/, (r: any) => {
    if (r.request().method() === 'POST') { sent['log'].push(r.request().postDataJSON()); return json({ success: true, data: { id: 5 } }, 201)(r); }
    return json({ success: true, data: [] })(r);
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/maintenance');

  // ticket
  await page.getByRole('button', { name: '+ Create ticket' }).click();
  const tk = dialog(page, 'Create maintenance ticket');
  await tk.getByRole('button', { name: 'Create ticket' }).click();
  await expect(tk.getByText('Choose the machine.')).toBeVisible();
  await expect(tk.getByText('Enter a title.')).toBeVisible();
  await tk.getByLabel('Machine').selectOption({ label: 'VMC-7' });
  await tk.getByLabel('Title').fill('Coolant leak');
  await tk.getByLabel('Assign to').selectOption({ label: 'ravi' });
  await tk.getByRole('button', { name: 'Create ticket' }).click();
  await expect(tk).toHaveCount(0);
  expect(sent['ticket']).toEqual([{ machine_id: 7, title: 'Coolant leak', description: '', issue_type: 'BREAKDOWN', priority: 'MEDIUM', assigned_to: 3 }]);

  // schedule
  await page.getByRole('tab', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: '+ New schedule' }).click();
  const sc = dialog(page, 'New maintenance schedule');
  await sc.getByRole('button', { name: 'Save schedule' }).click();
  await expect(sc.getByText('Choose the date and time.')).toBeVisible();
  await sc.getByLabel('Title').fill('Way lube refill');
  await sc.getByLabel('Machine').selectOption({ label: 'VMC-7' });
  await sc.getByLabel('Scheduled for').fill('2026-10-28T10:00');
  await sc.getByRole('button', { name: 'Save schedule' }).click();
  await expect(sc).toHaveCount(0);
  expect(sent['schedule'][0]).toMatchObject({ title: 'Way lube refill', machine_id: 7, scheduled_at: '2026-10-28T10:00' });

  // remove: the app's own dialog; Cancel keeps it
  const remove = page.getByRole('button', { name: 'Remove schedule Spindle check' });
  await remove.click();
  const ask = page.getByRole('alertdialog', { name: 'Remove the schedule "Spindle check"?' });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  expect(sent['removed']).toHaveLength(0);
  await remove.click();
  await ask.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => sent['removed'].length).toBe(1);
  expect(sent['removed'][0]).toMatch(/\/api\/maintenance\/schedules\/11$/);

  // log
  await page.getByRole('tab', { name: 'Logs' }).click();
  await page.getByRole('button', { name: '+ Log maintenance' }).click();
  const lg = dialog(page, 'Log maintenance work');
  await lg.getByLabel('Title').fill('Replaced coolant pump');
  await lg.getByLabel('Machine').selectOption({ label: 'VMC-7' });
  await lg.getByRole('button', { name: 'Save log' }).click();
  await expect(lg.getByText('Choose when the work started.')).toBeVisible();
  await lg.getByLabel('Started').fill('2026-10-18T09:00');
  await lg.getByRole('button', { name: 'Save log' }).click();
  await expect(lg).toHaveCount(0);
  expect(sent['log'][0]).toMatchObject({ title: 'Replaced coolant pump', machine_id: 7, started_at: '2026-10-18T09:00' });
});

test('Maintenance: a view-only role sees the lists, with no add or remove buttons', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user', permissions: ['page:maintenance:view'] });
  await stubApi(page);
  await page.route(/\/api\/maintenance\/schedules(\?.*)?$/, json({ success: true, data: [
    { id: 11, machine_serial_no: 'VMC-7', title: 'Spindle check', maintenance_type: 'PREVENTIVE', scheduled_at: '2026-10-25T04:30:00Z', status: 'SCHEDULED' }] }));
  await page.goto('/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Create ticket' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Schedules' }).click();
  await expect(page.getByText('Spindle check')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New schedule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remove schedule/ })).toHaveCount(0);
});

test('Tariff & Rates: Add tariff and Edit open the dialog; the page holds no form', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await stubApi(page);
  await page.route('**/api/charts/meta*', json({ success: true, data: { machines: [{ id: 25, machine_serial_no: 'HMC - 7 - F' }], shifts: [] } }));
  const saved: any[] = [];
  await page.route('**/api/dashboard/energy/settings*', (r: any) => {
    if (r.request().method() === 'POST') { saved.push(r.request().postDataJSON()); return json({ success: true })(r); }
    return json({ status: 'success', data: [{ machine_id: null, machine_serial_no: null, cost_per_kwh: 10.95, currency: 'INR', overload_kw: null }] })(r);
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/energy-tariff');
  await expect(page.getByRole('region', { name: 'Configured tariffs' })).toContainText('Company default');
  await expect(page.locator('#tfCost')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add tariff' }).click();
  const add = dialog(page, 'Add tariff');
  await add.getByRole('button', { name: 'Save tariff' }).click();
  await expect(add.getByRole('alert')).toHaveText('Enter a cost per kWh, an overload limit, or both.');
  await add.getByLabel('Applies to').selectOption({ label: 'HMC - 7 - F' });
  await add.getByLabel('Cost per kWh').fill('12.5');
  await add.getByRole('button', { name: 'Save tariff' }).click();
  await expect(add).toHaveCount(0);
  expect(saved[0]).toMatchObject({ machine_id: 25, cost_per_kwh: 12.5, currency: 'INR' });

  await page.getByRole('button', { name: 'Edit tariff for company default' }).click();
  const edit = dialog(page, 'Edit tariff');
  await expect(edit.getByLabel('Applies to')).toBeDisabled();
  await expect(edit.getByLabel('Cost per kWh')).toHaveValue('10.95');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toHaveCount(0);
});

test('My Profile: the details on the page; Edit and Change password open the dialog', async ({ authedPage: page }) => {
  await stubApi(page);
  let patched: any = null, password: any = null;
  const me = { id: 1, username: 'test', email: 'test@example.com', mobile: null, user_type: 'company_user',
               company_name: 'Acme Gears', plant_name: 'Plant 1', last_login_at: null };
  await page.route('**/api/auth/me', (r: any) => {
    if (r.request().method() !== 'PATCH') return json({ success: true, data: me })(r);
    patched = r.request().postDataJSON();
    return json({ success: true, data: { id: 1, username: 'test', ...patched } })(r);
  });
  await page.route('**/api/auth/change-password', (r: any) => { password = r.request().postDataJSON(); return json({ success: true })(r); });
  await page.goto('/profile');
  await expect(page.getByText('Acme Gears')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('#profEmail')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = dialog(page, 'Edit account details');
  await expect(edit.getByLabel('Email')).toHaveValue('test@example.com');
  await edit.getByLabel('Email').fill('not-an-email');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByText('Enter a valid email address, like name@company.com.')).toBeVisible();
  expect(patched).toBeNull();
  await edit.getByLabel('Email').fill('ravi@acme.in');
  await edit.getByLabel('Mobile').fill('98400 12345');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  expect(patched).toEqual({ email: 'ravi@acme.in', mobile: '98400 12345' });
  await expect(page.getByText('ravi@acme.in')).toBeVisible();

  await page.getByRole('button', { name: 'Change password' }).click();
  const pw = dialog(page, 'Change password');
  await pw.getByLabel('Current password').fill('old-pass-1');
  await pw.getByLabel(/^New password/).fill('new-pass-12');
  await pw.getByLabel('Confirm new password').fill('new-pass-13');
  await pw.getByRole('button', { name: 'Change password' }).click();
  await expect(pw.getByRole('alert')).toHaveText('New password and confirmation do not match.');
  await pw.getByLabel('Confirm new password').fill('new-pass-12');
  await pw.getByRole('button', { name: 'Change password' }).click();
  await expect(pw).toHaveCount(0);
  expect(password).toEqual({ current_password: 'old-pass-1', new_password: 'new-pass-12' });
});

test('Quality: rejected and rework parts are edited in the dialog, not in the tile', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.route('**/api/lines**', json({ success: true, data: [{ id: 2, name: 'Line 1' }] }));
  await page.route('**/api/master/machines**', json({ success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F', line_id: 2 }] }));
  await page.route('**/api/master/shifts**', json({ success: true, data: [{ id: 5, shift_code: 'MS01', shift_name: 'Morning', start_time: '08:00', end_time: '20:00' }] }));
  await page.route('**/api/quality*', json({ success: true, data: {
    machine: { machine_serial_no: 'VMC-1-F', operator_name: 'OP1', part_name: 'Shaft' },
    production: { produced: 50, reject: 2, rework: 1, accepted: 47, target_qty: 100, quality_percent: 94 },
    oee: { oee: 74.1, availability: 100, performance: 74.1, quality: 94 }, hourly: [] } }));
  let entry: any = null;
  await page.route('**/api/quality/entry', (r: any) => { entry = r.request().postDataJSON(); return json({ success: true })(r); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/quality');

  await page.getByRole('button', { name: 'Edit rejected quantity' }).click();
  const d = dialog(page, 'Edit quality counts');
  await expect(d).toContainText('VMC-1-F · Morning');
  await expect(d.getByLabel('Rejected parts')).toHaveValue('2');
  await expect(d.getByLabel('Rework parts')).toHaveValue('1');
  await d.getByLabel('Rejected parts').fill('-1');
  await d.getByRole('button', { name: 'Save counts' }).click();
  await expect(d.getByText('Enter a whole number, 0 or more.')).toBeVisible();
  expect(entry).toBeNull();
  await d.getByLabel('Rejected parts').fill('4');
  await d.getByRole('button', { name: 'Save counts' }).click();
  await expect(d).toHaveCount(0);
  expect(entry).toMatchObject({ machine_id: 1, shift_id: 5, reject_qty: 4, rework_qty: 1 });
});

test('the old /machines/create address opens the Machines list, not a dialog with nothing behind it', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.goto('/machines/create');
  await expect(page).toHaveURL(/\/machines$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
