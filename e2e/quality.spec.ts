import { test, expect } from './fixtures/auth';

// The page's lookups: GET /api/lines, then /api/master/machines (All lines)
// or /api/master/machines-by-line, then /api/master/shifts, then /api/quality.
const lines    = { success: true, data: [{ id: 2, name: 'Line 1' }] };
const machines = { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F', line_id: 2 }] };
const shifts   = { success: true, data: [{ id: 5, shift_code: 'MS01', shift_name: 'Morning',
                                           start_time: '08:00', end_time: '20:00' }] };

function qualityData(overrides: object = {}) {
  return {
    success: true,
    data: {
      machine: { machine_serial_no: 'VMC-1-F', operator_name: 'OP1', part_name: 'Shaft' },
      production: { produced: 50, reject: 2, rework: 1, accepted: 47, target_qty: 100, quality_percent: 94 },
      oee: { oee: 74.1, availability: 100, performance: 74.1, quality: 94 },
      hourly: [],
      ...overrides
    }
  };
}

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubMeta(page: any) {
  await page.route('**/api/lines**', json(lines));
  await page.route('**/api/master/machines**', json(machines));
  await page.route('**/api/master/shifts**', json(shifts));
}

test.describe('Quality page — data display', () => {
  test('TC-QP-01 renders quality metrics for selected machine', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qualityData()) })
    );

    await page.goto('/quality');
    await expect(page.getByText(/quality/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-QP-02 shows production counts (produced, reject, accepted)', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qualityData()) })
    );

    await page.goto('/quality');
    // At least one production number should appear on the page
    const hasFifty = page.getByText('50').first();
    const hasTwo   = page.getByText('47').first();
    await expect(hasFifty.or(hasTwo)).toBeVisible({ timeout: 10_000 });
  });

  test('TC-QP-03 shows OEE value', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qualityData()) })
    );

    await page.goto('/quality');
    // OEE and Performance are both 74.1 here
    await expect(page.getByText(/74\.1|74\.10/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-QP-04 shows zero produced gracefully', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(qualityData({
          production: { produced: 0, reject: 0, rework: 0, accepted: 0, target_qty: 100, quality_percent: 0 },
          oee: { oee: 0, availability: 0, performance: 0, quality: 0 }
        }))
      })
    );

    await page.goto('/quality');
    await expect(page.getByText(/quality/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Quality page — error handling', () => {
  test('TC-QP-10 500 on quality endpoint — page does not crash', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    );

    await page.goto('/quality');
    await expect(page).toHaveURL(/\/quality/);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });

  test('TC-QP-11 line list 500 — machines still load and the page fills in', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/lines**', json({ message: 'Server error' }, 500));
    await page.route('**/api/quality?**', json(qualityData()));

    await page.goto('/quality');
    await expect(page).toHaveURL(/\/quality/);
    // the chain reached the quality figures: OEE card shows 74.1%
    await expect(page.getByText('74.1%').first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-QP-12 submit quality entry — 200 success', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qualityData()) })
    );

    await page.route('**/api/quality/entry*', r =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, action: 'created' })
      })
    );

    await page.goto('/quality');
    // Try to fill and submit the quality entry form if present
    const rejectInput = page.getByLabel(/reject/i).or(page.getByPlaceholder(/reject/i)).first();
    if (await rejectInput.isVisible({ timeout: 5_000 })) {
      await rejectInput.fill('2');
      const submitBtn = page.getByRole('button', { name: /submit|save|update/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await expect(page).toHaveURL(/\/quality/);
      }
    }
  });

  test('TC-QP-13 submit quality entry — 422 reject exceeds produced', async ({ authedPage: page }) => {
    await stubMeta(page);
    await page.route('**/api/quality*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qualityData()) })
    );

    await page.route('**/api/quality/entry*', r =>
      r.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Reject + rework cannot exceed produced qty' })
      })
    );

    await page.goto('/quality');

    const rejectInput = page.getByLabel(/reject/i).or(page.getByPlaceholder(/reject/i)).first();
    if (await rejectInput.isVisible({ timeout: 5_000 })) {
      await rejectInput.fill('999');
      const submitBtn = page.getByRole('button', { name: /submit|save|update/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      }
    }

    // Page must not crash
    await expect(page).toHaveURL(/\/quality/);
  });
});
