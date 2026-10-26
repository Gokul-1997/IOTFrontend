import { test, expect, localFixtureOrigin } from './fixtures/auth';

test('Phase 3 remains hidden for the owner and direct navigation makes no licensing requests', async ({ sntSuperPage: page }) => {
  const origin=localFixtureOrigin(),calls:string[]=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname.startsWith('/api/licensing'))calls.push(url.pathname);
    return route.fulfill({json:url.pathname.includes('unread-count')?{success:true,count:0}:[]});
  });
  await page.goto('/admin/companies');
  await expect(page.locator('app-admin-tabs')).toBeVisible();
  await expect(page.getByRole('link',{name:'Deployment licenses',exact:true})).toHaveCount(0);
  await page.goto('/admin/licensing');
  await expect(page).toHaveURL(/\/admin\/companies$/);
  await expect(page.getByRole('heading',{name:'Deployment licenses',exact:true})).toHaveCount(0);
  expect(calls).toEqual([]);
});
