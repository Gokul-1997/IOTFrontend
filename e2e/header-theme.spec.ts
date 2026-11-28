import { test, expect, seedAuth } from './fixtures/auth';

/*
 * 28 Nov 2026, the user: the dark theme's header "is perfect, please set" it.
 * The top bar — logo, menu, bell, account and the lists they open — is the
 * dark theme's in both themes; the page below follows the chosen theme.
 */
const json = (status: number, body: any) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} theme: the header is the dark one; the page follows the theme`, async ({ page }) => {
    await seedAuth(page);
    await page.addInitScript(t => localStorage.setItem('theme', t), theme);
    // every call answered here: environment.ts points at the live API
    await page.route('**/api/**', r => r.fulfill(json(200, { success: true, data: [] })));
    await page.route('**/api/components**', r => r.fulfill(json(200, { success: true, data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/component');

    const bar = page.locator('app-header > header');
    await expect(bar).toHaveCSS('background-color', 'rgb(25, 24, 74)');                       // #19184a
    await expect(page.locator('app-header img[src*="STM_Mexa_logo_white"]')).toBeVisible();
    await expect(page.locator('app-header img[src$="STM_Mexa_logo.svg"]')).toBeHidden();
    await expect(page.locator('app-header nav[aria-label="Main"] .nav-btn:not(.active)').first())
      .toHaveCSS('background-color', 'rgb(59, 72, 147)');                                       // #3b4893
    await expect(page.locator('app-header .hdr-chevron')).toHaveCSS('color', 'rgb(156, 163, 175)');
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');

    // what the header opens is dark as well
    await page.getByRole('button', { name: /^Account menu/ }).click();
    await expect(page.locator('#account-menu')).toHaveCSS('background-color', 'rgb(3, 23, 53)');  // #031735
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.locator('#notif-panel')).toHaveCSS('background-color', 'rgb(3, 23, 53)');
  });
}
