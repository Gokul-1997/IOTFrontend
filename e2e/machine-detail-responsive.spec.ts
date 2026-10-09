import type { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

const machineName = 'HMC-7-F / Precision Manufacturing Cell 004 — Main Production Line';
const operatorName = 'Ramakrishnan Subramanian — Senior Production Operator';
const partName = 'Precision turbine housing / Finish machining — Revision C';
const componentId = 'COMPONENT-2026-PRECISION-TURBINE-HOUSING-000487';
const localOrigin = 'http://127.0.0.1:4494';

async function openMachine(page: Page, dark = false) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], plant_id: null });
  await page.addInitScript(theme => localStorage.setItem('theme', theme), dark ? 'dark' : 'light');
  // Every API, WebSocket and external asset is isolated from production.
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ json: { status: 'success', data: [], unread: 0 } });
    }
    return url.origin === localOrigin ? route.continue() : route.abort();
  });

  await page.route('**/api/dashboard/live/25', route => route.fulfill({ json: {
    status: 'success', data: {
      machine: { id: 25, machine_serial_no: machineName },
      operator: { operator_name: operatorName, employee_id: 'OPERATOR-MFG-TEAM-A-00001234' },
      job: { part_name: partName, component_id: componentId, target_qty: 240, achieved_qty: 150 },
      oee: { oee: 61.5, availability: 82, performance: 76, quality: 98.7 },
      shift: { shift_code: 'DAY SHIFT — PRODUCTION' },
      quality: { accepted: 148, rejected: 2 },
      power: { shift_kwh: 14.375, total_kwh: 12845.625 },
      production: { run_time: '02:14:22', idle_time: '00:37:15', manual_seconds: 3661 },
      live: {
        machine_status: 'IDLE', mode: 'MEM', spindle_load: 35, feed_rate: 1500,
        parts_count: 150, alarm: true,
        active_alarms: [{ alarm_code: 'EX1032', alarm_type: 'AIR PRESSURE LOW',
          message: 'AIR PRESSURE LOW — Check the compressed air supply to the spindle tool changer.',
          severity: 'NORMAL', started_at: '2026-10-07T05:21:47.000Z' }]
      }
    }
  } }));
  await page.route('**/api/dashboard/live/25/timeline', route => {
    const end = Date.now() + 4 * 3600_000;
    const start = end - 8 * 3600_000;
    return route.fulfill({ json: { status: 'success', data: {
      shift: { id: 5, code: 'DAY', name: 'Production', start, end, break_minutes: 30 },
      now: start + 4 * 3600_000,
      segments: [
        { state: 'RUNNING', from: start, to: start + 2 * 3600_000 },
        { state: 'IDLE', from: start + 2 * 3600_000, to: start + 3 * 3600_000 },
        { state: 'ALARM', from: start + 3 * 3600_000, to: start + 4 * 3600_000 }
      ],
      breaks: [{ name: 'Tea break', from: start + 2 * 3600_000, to: start + 2.25 * 3600_000 }],
      breaks_configured: true,
      totals: { elapsed: 4 * 3600_000, RUNNING: 2 * 3600_000, IDLE: 3600_000,
        ALARM: 3600_000, OFF: 0, breaks: 15 * 60_000 }
    } } });
  });
  await page.route('**/api/dashboard/live/25/spindle*', route => {
    const to = Date.now();
    return route.fulfill({ json: { status: 'success', data: {
      machine: { id: 25, serial: machineName, rated_rpm: 10000 },
      range: { key: '1h', from: to - 3600_000, to, bucket_seconds: 60 },
      thresholds: { load_high: 80, load_overload: 100 },
      latest: { at: to - 5000, load: 35, rpm: 2500, feed: 1500, status: 'IDLE', stale: false },
      points: [
        { t: Math.floor((to - 120_000) / 60_000) * 60_000, load_avg: 30, load_max: 60, rpm_avg: 2400, rpm_max: 2600, feed_avg: 1200, feed_max: 1500, samples: 12 },
        { t: Math.floor((to - 60_000) / 60_000) * 60_000, load_avg: 40, load_max: 82, rpm_avg: 2500, rpm_max: 4800, feed_avg: 1300, feed_max: 3000, samples: 12 }
      ],
      summary: {
        samples: 24, turning: 20, first_at: to - 120_000, last_at: to - 5000,
        load: { min: 2, avg: 35, max: 82, high_pct: 10, overload_pct: 0 },
        rpm: { min: 800, avg: 2450, max: 4800, max_of_rated_pct: 48 },
        feed: { min: 50, avg: 1250, max: 3000, feeding: 18 }
      }
    } } });
  });

  await page.goto('/dashboard/live/25');
  await expect(page.getByRole('heading', { name: machineName, exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: /Spindle load/ })).toContainText('35%');
}

async function expectContent(page: Page) {
  await expect(page.getByRole('alert')).toContainText('EX1032');
  await expect(page.getByRole('alert')).toContainText('AIR PRESSURE LOW');
  await expect(page.getByRole('link', { name: /Back/ })).toBeVisible();
  for (const text of [operatorName, partName, componentId]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  // The values the API sends and the operator's controls stay on the page at every width.
  const detail = page.locator('app-live');
  for (const text of ['02h 14m 22s', '00h 37m 15s', '01h 01m 01s', '61.5%', 'Accepted', 'Rejected', 'Utilization']) {
    await expect(detail).toContainText(text);
  }
  await expect(page.getByRole('region', { name: /Shift Timeline/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Spindle speed/ })).toContainText('2,500rpm');
  await expect(page.getByRole('article', { name: /Feed rate/ })).toContainText('1,500mm/min');
}

async function expectNoOverflow(page: Page) {
  // ApexCharts resizes asynchronously. Wait for the rendered chart to fill its
  // available host after both shrinking and growing the viewport.
  await expect.poll(() => page.locator('app-spindle-panel apx-chart').evaluate(host => {
    const canvas = host.querySelector('.apexcharts-canvas');
    const hostWidth = host.getBoundingClientRect().width;
    const canvasWidth = canvas?.getBoundingClientRect().width ?? 0;
    return hostWidth > 0 && canvasWidth >= hostWidth * 0.9 && canvasWidth <= hostWidth + 1;
  }), { message: 'The spindle trend should fill its available chart width' }).toBe(true);
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  })).then(({ document, viewport }) => document <= viewport + 1)).toBe(true);
  for (const text of [machineName, operatorName, partName, componentId]) {
    const box = await page.getByText(text, { exact: true }).boundingBox();
    expect(box, `No visible box for ${text}`).not.toBeNull();
    expect(box!.x, `${text} extends beyond the left edge`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${text} extends beyond the right edge`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

test('machine detail keeps key information readable from small phones to wide monitors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMachine(page);
  for (const width of [360, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await expectContent(page);
    await expectNoOverflow(page);
    if (width === 390 || width === 1280) {
      await page.screenshot({ path: testInfo.outputPath(`machine-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  expect(errors).toEqual([]);
});

test('dark mode and reduced motion retain readable alarms and machine readings', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMachine(page, true);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expectContent(page);
  await expectNoOverflow(page);
  const continuousAnimations = await page.locator('app-live').evaluate(element =>
    element.getAnimations({ subtree: true }).filter(animation =>
      animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity
    ).length
  );
  expect(continuousAnimations).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('machine-dark-phone.png'), fullPage: true, animations: 'disabled' });
});
