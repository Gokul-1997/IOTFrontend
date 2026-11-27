import { test, expect } from './fixtures/auth';

const operator = { id: 7, operator_code: 'OP-7', operator_name: 'Operator Seven', skill_level: '', shift_id: 10, machine_ids: [], is_active: true, phone_number: '+91 98765 43210', date_of_birth: '1995-02-28' };

async function serve(page: any) {
  const writes: any[] = [];
  await page.route('**/api/**', async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/operators/7' && route.request().method() === 'GET') return route.fulfill({ json: { status: 'success', data: operator } });
    if (path.startsWith('/api/operators') && ['POST', 'PUT'].includes(route.request().method())) {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { status: 'success', data: { operator_id: 7 } } });
    }
    if (path === '/api/operators') return route.fulfill({ json: { status: 'success', data: [operator], meta: { page: 1, total: 1, limit: 10 } } });
    if (path === '/api/shifts') return route.fulfill({ json: { data: [{ id: 10, shift_name: 'Day shift', start_time: '08:00', end_time: '16:00' }] } });
    return route.fulfill({ json: { status: 'success', success: true, data: [] } });
  });
  await page.goto('/operators');
  return writes;
}

async function openCreate(page: any) {
  await page.getByRole('button', { name: 'Add Operator', exact: true }).click();
  await page.getByLabel(/Employee ID/).fill('OP-8');
  await page.getByLabel(/Operator name/).fill('Operator Eight');
  await page.locator('#opShift').selectOption({ label: 'Day shift (08:00 – 16:00)' });
}

test('create succeeds with phone and DOB blank; Employee ID is still required', async ({ authedPage: page }) => {
  const writes = await serve(page);
  await openCreate(page);
  await expect(page.getByLabel(/Phone number/)).not.toHaveAttribute('required');
  await expect(page.getByLabel(/Date of birth/)).not.toHaveAttribute('required');
  await page.getByLabel(/Employee ID/).fill('');
  await page.getByRole('button', { name: 'Create operator', exact: true }).click();
  await expect(page.getByText('Employee ID is required.')).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByLabel(/Employee ID/).fill('OP-8');
  await page.getByRole('button', { name: 'Create operator', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes[0]).toMatchObject({ phone_number: '', date_of_birth: '', operator_code: 'OP-8' });
});

test('create sends the optional phone and calendar birth date', async ({ authedPage: page }) => {
  const writes = await serve(page);
  await openCreate(page);
  await page.getByLabel(/Phone number/).fill('+91 98765 43210');
  await page.getByLabel(/Date of birth/).fill('1995-02-28');
  await page.getByRole('button', { name: 'Create operator', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes[0]).toMatchObject({ phone_number: '+91 98765 43210', date_of_birth: '1995-02-28' });
});

test('edit shows saved details and lets either optional field be cleared', async ({ authedPage: page }) => {
  const writes = await serve(page);
  await page.getByRole('button', { name: 'Edit Operator Seven', exact: true }).click();
  await expect(page.getByLabel(/Phone number/)).toHaveValue('+91 98765 43210');
  await expect(page.getByLabel(/Date of birth/)).toHaveValue('1995-02-28');
  await page.getByLabel(/Phone number/).fill('');
  await page.getByLabel(/Date of birth/).fill('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes[0]).toMatchObject({ phone_number: '', date_of_birth: '' });
});

test('invalid phone and future DOB block submission with clear errors', async ({ authedPage: page }) => {
  const writes = await serve(page);
  await openCreate(page);
  await page.getByLabel(/Phone number/).fill('invalid phone');
  await page.getByLabel(/Date of birth/).fill('2999-01-01');
  await page.getByRole('button', { name: 'Create operator', exact: true }).click();
  await expect(page.getByText('Enter a valid phone number, or leave it blank.')).toBeVisible();
  await expect(page.getByText(/Enter a valid birth date that is not in the future/)).toBeVisible();
  expect(writes).toHaveLength(0);
});
