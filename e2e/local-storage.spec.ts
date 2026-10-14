import { test, expect, seedAuth } from './fixtures/auth';

const origin = 'http://127.0.0.1:4496';
const imagePath = '/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.png';
const uploadedPath = imagePath.replace('cc1.png', 'cc2.png');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR3sAAAAASUVORK5CYII=', 'base64');
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('machine photo uploads locally, remains private, previews correctly and prevents premature saving', async ({ page }) => {
  await seedAuth(page, { plant_id: 1 });
  await page.routeWebSocket(/.*/, socket => socket.close());
  const pending = gate();
  const imageRequests: string[] = [];
  const machineWrites: any[] = [];
  let uploaded = false, multipart = '';
  const rows: any[] = [{ id: 9, plant_id: 1, line_id: 3, machine_serial_no: 'CNC-9', image_url: imagePath, is_active: true }];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
    if (path.startsWith('/api/files/')) {
      expect(request.headers()['authorization']).toMatch(/^Bearer /);
      imageRequests.push(path);
      return route.fulfill({ contentType: 'image/png', body: png, headers: { 'Cache-Control': 'private, no-cache' } });
    }
    if (path === '/api/upload') {
      expect(request.headers()['authorization']).toMatch(/^Bearer /);
      multipart = request.postData() || '';
      uploaded = true;
      await pending.promise;
      return route.fulfill({ status: 201, json: { fileUrl: uploadedPath } });
    }
    if (path === '/api/machines' && request.method() === 'POST') {
      const machine = request.postDataJSON(); machineWrites.push(machine);
      rows.push({ ...machine, id: 10 });
      return route.fulfill({ status: 201, json: { data: rows.at(-1) } });
    }
    if (path === '/api/machines') return route.fulfill({ json: { data: rows, meta: { total: rows.length, totalPages: 1 } } });
    if (path === '/api/master/plants') return route.fulfill({ json: { data: [{ id: 1, plant_name: 'Main plant' }] } });
    if (path === '/api/lines') return route.fulfill({ json: { data: [{ id: 3, plant_id: 1, name: 'Line 3' }] } });
    return route.fulfill({ json: { data: [], unread: 0 } });
  });
  await page.goto('/machines');
  const existing = page.locator('.machine-thumb').first();
  await existing.scrollIntoViewIfNeeded();
  await expect(existing).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => existing.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await page.getByRole('button', { name: 'New Machine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Machine' });
  await dialog.locator('#mfSerial').fill('PHOTO-CNC');
  await dialog.locator('#mfLine').selectOption({ label: 'Line 3' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => uploaded).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
  expect(machineWrites).toHaveLength(0);
  expect(multipart).toContain('name="plant_id"');
  expect(multipart).toContain('name="file"; filename="photo.png"');
  pending.release();
  await expect(dialog.getByRole('button', { name: 'Create Machine', exact: true })).toBeEnabled();
  const preview = dialog.locator('img');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/local-storage-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create Machine', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(machineWrites[0].image_url).toBe(uploadedPath);
  // The existing compact mobile register hides its photo column.
  await page.setViewportSize({ width: 1280, height: 800 });
  const created = page.getByRole('row', { name: /PHOTO-CNC/ }).locator('img');
  await created.scrollIntoViewIfNeeded();
  await expect(created).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => created.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  expect(imageRequests.filter(path => path === uploadedPath)).toHaveLength(1);
});

test('repeated local images share one download and legacy HTTPS images never receive a Bearer token', async ({ page }) => {
  await seedAuth(page);
  await page.routeWebSocket(/.*/, socket => socket.close());
  let localDownloads = 0, legacyDownloads = 0;
  const legacy = 'https://old-bucket.example/images/machine.png';
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.url() === legacy) {
      expect(request.headers()['authorization']).toBeUndefined();
      legacyDownloads++;
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (path.startsWith('/api/files/')) {
      expect(request.headers()['authorization']).toMatch(/^Bearer /);
      localDownloads++;
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (path === '/api/dashboard') return route.fulfill({ json: {
      shift: {}, summary: { total: 3 }, pagination: { page: 1, per_page: 6, total: 3, total_pages: 1 },
      machines: [1, 2, 3].map(id => ({ machine_id: id, machine_serial_no: `CNC-${id}`, image_url: id === 3 ? legacy : imagePath,
        status: 'RUNNING', received_at: Math.floor(Date.now() / 1000) }))
    } });
    if (path.startsWith('/api/')) return route.fulfill({ json: { data: [], unread: 0 } });
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.goto('/dashboard');
  const images = page.locator('img.dashboard_machine_all');
  await expect(images).toHaveCount(3);
  await images.nth(0).scrollIntoViewIfNeeded();
  await expect(images.nth(0)).toHaveAttribute('src', /^blob:/);
  await expect(images.nth(1)).toHaveAttribute('src', /^blob:/);
  await expect(images.nth(2)).toHaveAttribute('src', legacy);
  await expect.poll(() => legacyDownloads).toBe(1);
  expect(localDownloads).toBe(1);
});
