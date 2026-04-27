import { test, expect } from '@playwright/test';

/**
 * Login page should render and validate inputs even with no backend.
 * Network calls are mocked so this passes in CI without spinning up the API.
 */

test.describe('Login page', () => {
  test('renders email + password fields and submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible();
  });

  test('shows validation error when fields are empty', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByRole('button', { name: /sign in|login/i });
    await submit.click();
    // either HTML5 invalid state, or an error message — either is acceptable
    const emailField = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first();
    const validity = await emailField.evaluate((el: HTMLInputElement) => el.validity?.valid);
    expect(validity).toBeFalsy();
  });

  test('handles invalid credentials gracefully', async ({ page }) => {
    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid credentials' })
      });
    });

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first().fill('bad@x.com');
    await page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first().fill('wrong');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // App should NOT navigate away on auth failure
    await expect(page).toHaveURL(/\/login/);
  });
});
