import { test, expect, localFixtureOrigin } from './fixtures/auth';

const titles = ['Critical Alarm Trend', 'Alarms by Severity', 'Machine Wise Critical Alarms', 'Top 5 Alarm Reasons'];
const cardAppearance = (el: Element) => {
  const card = getComputedStyle(el), title = getComputedStyle(el.querySelector('h2')!);
  return {
    border: card.border, radius: card.borderRadius, padding: card.padding, shadow: card.boxShadow,
    font: title.fontSize, weight: title.fontWeight, lineHeight: title.lineHeight, titleMargin: title.marginBottom
  };
};
const fixture = (empty = false) => ({
  updated_at: new Date().toISOString(),
  kpis: { critical_alarms: empty ? 0 : 40, critical_alarms_open: 20, pm_generated: 25, pm_open: 5, pm_completed: 20,
    pm_overdue: 3, avg_resolution_hours: 19.75, resolved_count: 18, rules: 2 },
  alarm_trend: empty ? [] : [8, 12, 7, 16, 10, 6, 14].map((critical, i) => ({ day: new Date(Date.now() - (6-i)*86400000).toISOString(), critical })),
  alarm_severity: empty ? { critical: 0, non_critical: 0, information: 0 } : { critical: 24, non_critical: 16, information: 8 },
  alarms_by_machine: empty ? [] : [24, 18, 12, 7, 1].map((critical, i) => ({ machine_serial_no: `CNC-0${i+1}`, critical })),
  top_alarm_reasons: empty ? [] : ['Spindle Overload', 'Servo Drive Overload', 'High Spindle Temperature', 'Hydraulic Pressure Low', 'Lubrication Alarm'].map((alarm_type, i) => ({ alarm_type, occurrences: [24,18,12,7,1][i] })),
  tickets: { data: [{ ticket_id: 'PM-2026-041', machine_serial_no: 'CNC-01', alarm_name: 'Spindle Overload', priority: 'HIGH', status: 'OPEN', age_hours: 6, created_at: new Date().toISOString(), due_date: new Date(Date.now()+86400000).toISOString() }], total: 1, page: 1, limit: 10, totalPages: 1 },
  ticket_status: { open: 5, completed: 20, in_progress: 0 }, alarm_triggers: []
});
async function mock(page: any, empty = false) {
  const origin = localFixtureOrigin(), requests: URL[] = [], errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.route('**/*', async (route: any) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/charts/meta') return route.fulfill({ json: { success: true, data: { machines: [{id:1,machine_serial_no:'CNC-01'},{id:2,machine_serial_no:'CNC-02'}], shifts: [] } } });
    if (url.pathname === '/api/dashboard/preventive') { requests.push(url); return route.fulfill({ json: {status:'success',data:fixture(empty)} }); }
    if (url.pathname.endsWith('/thresholds')) return route.fulfill({ json: {status:'success',data:[]} });
    return route.fulfill({ json: {status:'success',success:true,data:[],count:0} });
  });
  return {requests,errors};
}

for (const dark of [false, true]) {
  test(`same four charts fit desktop, tablet and phone in ${dark ? 'dark' : 'light'} theme`, async ({authedPage:page}) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), dark ? 'dark' : 'light');
    const f = await mock(page);
    await page.setViewportSize({width:1440,height:900});
    await page.goto('/energy-dashboard');
    const energyCard = page.locator('#dashPanel-charts .mexa-grid > .mexa-card').first();
    await expect(energyCard.locator('h2')).toBeVisible();
    const energyAppearance = await energyCard.evaluate(cardAppearance);
    await page.goto('/preventive-maintenance');
    await expect(page.locator('.pv-chart-card')).toHaveCount(4);
    await expect(page.locator('apx-chart .apexcharts-canvas')).toHaveCount(4);
    await expect(page.locator('.pv-chart-card > h2')).toHaveText(titles);
    await expect(page.locator('.pv-chart-card > header')).toHaveCount(0);
    await expect(page.locator('#dashPanel-charts')).toHaveCSS('background-color', dark ? 'rgb(3, 23, 53)' : 'rgb(255, 255, 255)');
    await expect(page.getByText('Maintenance planning', {exact:true})).toHaveCount(0);
    await expect(page.getByText('Track critical alarms, preventive work and resolution performance.', {exact:true})).toHaveCount(0);
    await expect(page.locator('.mexa-titlebar .titlebar .mexa-title')).toHaveText('Preventive Maintenance Dashboard');
    await expect(page.locator('.last-updated-vertical .updated-time')).toContainText('Updated');
    await expect(page.locator('.mexa-kpis .mexa-kpi')).toHaveCount(5);
    // share and count, as the Energy and Alarm Report keys read (28 Oct 2026)
    await expect(page.locator('.pv-severity-key .mexa-key-value')).toHaveText(['50% (24)','33.3% (16)','16.7% (8)']);
    const cards = page.locator('.pv-chart-card');
    for (const card of await cards.all()) expect(await card.evaluate(cardAppearance)).toEqual(energyAppearance);
    const first = (await cards.nth(0).boundingBox())!, second = (await cards.nth(1).boundingBox())!;
    expect(Math.abs(first.y-second.y)).toBeLessThan(2); expect(second.x).toBeGreaterThan(first.x+first.width);
    await expect.poll(() => cards.nth(3).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.screenshot({path:`/private/tmp/mexa-preventive-${dark?'dark':'light'}-desktop.png`,fullPage:true});
    for (const width of [768,390,360]) {
      await page.setViewportSize({width,height:900});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if(width<768) {
        await expect.poll(() => cards.evaluateAll(els => {
          const a=els[0].getBoundingClientRect(), b=els[1].getBoundingClientRect();
          return b.top >= a.bottom && Math.abs(a.left-b.left) < 2;
        })).toBe(true);
      }
      for(const title of titles) await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    }
    await page.screenshot({path:`/private/tmp/mexa-preventive-${dark?'dark':'light'}-phone.png`,fullPage:true});
    expect(f.requests).toHaveLength(1);expect(f.errors).toEqual([]);
  });
}
test('filters, detail tabs and ticket drill-down retain their existing request flow',async({authedPage:page})=>{
  const f=await mock(page);await page.goto('/preventive-maintenance');
  await expect(page.locator('apx-chart')).toHaveCount(4);expect(f.requests[0].searchParams.get('part')).toBe('kpis,charts');
  await page.getByRole('tab',{name:'PM Ticket Details',exact:true}).click();
  await expect(page.locator('#pvTickets')).toContainText('PM-2026-041');expect(f.requests.at(-1)?.searchParams.get('part')).toBe('table');
  const count=f.requests.length;await page.getByRole('tab',{name:'Charts',exact:true}).click();await expect(page.locator('apx-chart')).toHaveCount(4);expect(f.requests.length).toBe(count);
  await page.locator('#pvMachine').selectOption({label:'CNC-02'});await expect.poll(()=>f.requests.at(-1)?.searchParams.get('machine_id')).toBe('2');
  await page.getByRole('button',{name:/Open PM tickets: 5/}).click();await expect(page.locator('#pvTickets')).toBeVisible();
  expect(f.requests.at(-1)?.searchParams.get('show')).toBe('open');
  await page.getByRole('button',{name:'Alarm rules',exact:true}).click();await expect(page.locator('#pvRules')).toBeVisible();
  expect(f.errors).toEqual([]);
});
test('empty charts each show one clear placeholder',async({authedPage:page})=>{
  const f=await mock(page,true);await page.goto('/preventive-maintenance');await expect(page.locator('.pv-chart-card')).toHaveCount(4);
  await expect(page.locator('.pv-chart-card .pv-empty')).toHaveCount(4);await expect(page.locator('.pv-empty .material-icons')).toHaveCount(4);
  await expect(page.locator('apx-chart')).toHaveCount(0);expect(f.errors).toEqual([]);
});
