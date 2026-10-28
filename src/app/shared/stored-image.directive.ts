import { Directive, ElementRef, HostListener, Input, OnChanges, OnDestroy, Renderer2 } from '@angular/core';
import { Subscription } from 'rxjs';
import { ImageLease, StoredImageService } from '../core/services/stored-image.service';

/*
 * A machine that has no photo added shows a quiet "No photo" mark, not the
 * stock picture of a machine (28 Oct 2026, the user). Only that: a machine
 * with a photo loads and falls back exactly as it always did.
 */
const NO_PHOTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linejoin="round">' +
  '<rect x="55" y="16" width="90" height="74" rx="6"/><rect x="67" y="28" width="46" height="34" rx="3"/>' +
  '<rect x="121" y="28" width="13" height="34" rx="2"/><path d="M48 98h104"/>' +
  '<text x="100" y="126" fill="#94a3b8" stroke="none" font-family="system-ui,sans-serif" font-size="15" font-weight="600" text-anchor="middle">No photo</text></svg>';
export const NO_PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(NO_PHOTO_SVG);

/** Keeps Bearer tokens out of image URLs and uses one loader for all views. */
@Directive({ selector: 'img[appStoredImage]', standalone: true })
export class StoredImageDirective implements OnChanges, OnDestroy {
  @Input() appStoredImage: string | null | undefined;
  @Input() imageFallback = '/images/product/machine_login_02.png';
  private lease?: ImageLease;
  private subscription?: Subscription;
  private observer?: IntersectionObserver;
  private visible = typeof IntersectionObserver === 'undefined';

  constructor(private element: ElementRef<HTMLImageElement>, private renderer: Renderer2, private images: StoredImageService) {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        const visible = entries.some(entry => entry.isIntersecting);
        if (visible === this.visible) return;
        this.visible = visible;
        this.render();
      }, { rootMargin: '200px' });
      this.observer.observe(element.nativeElement);
    }
  }

  ngOnChanges(): void {
    this.render();
  }

  private render(): void {
    this.release();
    const value = this.appStoredImage || '';
    // no photo added for this machine
    if (!value) { this.setSource(NO_PHOTO); return; }
    const protectedUrl = this.images.protectedUrl(value);
    if (protectedUrl) {
      if (!this.visible) { this.setSource(this.imageFallback); return; }
      this.lease = this.images.acquire(protectedUrl);
      this.subscription = this.lease.source$.subscribe(source => this.setSource(source || this.imageFallback));
      return;
    }
    // Old S3 URLs remain readable during migration, without API credentials.
    // The blob branch is only the temporary preview of a locally selected file.
    const direct = (/^https:\/\//i.test(value) && !value.includes('/api/files/')) || /^blob:/.test(value) || /^\/images\//.test(value);
    this.setSource(direct ? value : this.imageFallback);
  }

  @HostListener('error') onError(): void {
    if (this.element.nativeElement.getAttribute('src') !== this.imageFallback) this.setSource(this.imageFallback);
  }

  ngOnDestroy(): void { this.observer?.disconnect(); this.release(); }

  private setSource(value: string): void {
    // a class to style or find the mark by
    if (value === NO_PHOTO) this.renderer.addClass(this.element.nativeElement, 'is-no-photo');
    else this.renderer.removeClass(this.element.nativeElement, 'is-no-photo');
    if (this.element.nativeElement.getAttribute('src') === value) return;
    if (value) this.renderer.setAttribute(this.element.nativeElement, 'src', value);
    else this.renderer.removeAttribute(this.element.nativeElement, 'src');
  }

  private release(): void {
    this.subscription?.unsubscribe();
    this.lease?.release();
    this.subscription = undefined;
    this.lease = undefined;
  }
}
