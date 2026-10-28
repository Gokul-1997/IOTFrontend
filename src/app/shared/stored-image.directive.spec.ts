import { Component, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { NO_PHOTO, StoredImageDirective } from './stored-image.directive';
import { StoredImageService } from '../core/services/stored-image.service';

@Component({ standalone: true, imports: [StoredImageDirective], template: '<img [appStoredImage]="image()" />' })
class Host { image = signal('/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.png'); }
let fixture: ComponentFixture<Host>, callback: IntersectionObserverCallback, service: any;
let release: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  release = vi.fn(); disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe() {}
    disconnect = disconnect;
  });
  service = {
    protectedUrl: (value: string) => value.startsWith('/api/files/') ? 'https://own-api.example' + value : null,
    acquire: vi.fn().mockReturnValue({ source$: new BehaviorSubject('blob:private-image'), release })
  };
  TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: StoredImageService, useValue: service }] });
  fixture = TestBed.createComponent(Host); fixture.detectChanges();
});
afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); });
const visible = (value: boolean) => callback([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver);

test('offscreen files defer download and release their consumer when they leave the viewport', () => {
  expect(service.acquire).not.toHaveBeenCalled();
  visible(true);
  expect(service.acquire).toHaveBeenCalledOnce();
  expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('blob:private-image');
  visible(false); expect(release).toHaveBeenCalledOnce();
  visible(true); expect(service.acquire).toHaveBeenCalledTimes(2);
});

test('legacy HTTPS images use direct src and visibility changes do not assign it twice', () => {
  fixture.componentInstance.image.set('https://old-bucket.example/image.png'); fixture.detectChanges();
  const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
  const assigned = vi.spyOn(image, 'setAttribute');
  visible(true);
  expect(image.getAttribute('src')).toBe('https://old-bucket.example/image.png');
  expect(service.acquire).not.toHaveBeenCalled();
  expect(assigned).not.toHaveBeenCalled();
});

test('a foreign local-file-looking URL and unsafe URL show the "No photo" mark', () => {
  fixture.componentInstance.image.set('https://foreign.example/api/files/companies/4/images/machines/file.png'); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(NO_PHOTO);
  fixture.componentInstance.image.set('javascript:alert(1)'); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(NO_PHOTO);
  expect(service.acquire).not.toHaveBeenCalled();
});

/* 28 Oct 2026, the user: a machine with no image added showed one anyway — a stock photo of another machine */
test('no photo added: the "No photo" mark, never a stock picture of a machine', () => {
  const img = () => fixture.nativeElement.querySelector('img') as HTMLImageElement;
  fixture.componentInstance.image.set(''); fixture.detectChanges();
  expect(img().getAttribute('src')).toBe(NO_PHOTO);
  expect(img().classList).toContain('is-no-photo');
  expect(decodeURIComponent(NO_PHOTO)).toContain('No photo');
  expect(img().getAttribute('src')).not.toContain('machine_login');
  fixture.componentInstance.image.set('https://old-bucket.example/image.png'); fixture.detectChanges();
  expect(img().classList).not.toContain('is-no-photo');
  img().dispatchEvent(new Event('error'));                              // a photo that cannot be read: the mark too
  expect(img().getAttribute('src')).toBe(NO_PHOTO);
});

test('a stored photo: nothing while it is on its way, the photo when it comes, the mark if it cannot be read', () => {
  const source$ = new BehaviorSubject<string | null>(null);
  service.acquire.mockReturnValue({ source$, release });
  const img = () => fixture.nativeElement.querySelector('img') as HTMLImageElement;
  expect(img().getAttribute('src')).toMatch(/^data:image\/gif/);       // off-screen: nothing yet
  visible(true);
  expect(img().getAttribute('src')).toMatch(/^data:image\/gif/);       // downloading: still nothing, no stand-in
  expect(img().classList).not.toContain('is-no-photo');
  source$.next(null);                                                   // could not be read
  expect(img().getAttribute('src')).toBe(NO_PHOTO);
});
