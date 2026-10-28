import { Directive, ElementRef, HostListener, Input, OnChanges, OnDestroy, Renderer2 } from '@angular/core';
import { Subscription } from 'rxjs';
import { ImageLease, StoredImageService } from '../core/services/stored-image.service';

/*
 * A machine with no photo shows a quiet "No photo" mark, not a stock picture
 * of some other machine (28 Oct 2026, the user: "machines with no image added
 * all show an image"). The same mark when its photo cannot be shown.
 */
const NO_PHOTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linejoin="round">' +
  '<rect x="55" y="16" width="90" height="74" rx="6"/><rect x="67" y="28" width="46" height="34" rx="3"/>' +
  '<rect x="121" y="28" width="13" height="34" rx="2"/><path d="M48 98h104"/>' +
  '<text x="100" y="126" fill="#94a3b8" stroke="none" font-family="system-ui,sans-serif" font-size="15" font-weight="600" text-anchor="middle">No photo</text></svg>';
export const NO_PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(NO_PHOTO_SVG);
/** Nothing at all, while a stored photo is still on its way. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Keeps Bearer tokens out of image URLs and uses one loader for all views. */
@Directive({ selector: 'img[appStoredImage]', standalone: true })
export class StoredImageDirective implements OnChanges, OnDestroy {
  @Input() appStoredImage: string | null | undefined;
  @Input() imageFallback = NO_PHOTO;
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
    if (!value) { this.setSource(this.imageFallback); return; }
    const protectedUrl = this.images.protectedUrl(value);
    if (protectedUrl) {
      if (!this.visible) { this.setSource(BLANK); return; }
      this.lease = this.images.acquire(protectedUrl);
      // the first "none yet" is the download starting; a later one, that it could not be read
      let first = true;
      this.subscription = this.lease.source$.subscribe(source => {
        this.setSource(source || (first ? BLANK : this.imageFallback));
        first = false;
      });
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
    const img = this.element.nativeElement;
    // a class to style or find the mark by, beside the picture it stands in for
    if (value === this.imageFallback) this.renderer.addClass(img, 'is-no-photo');
    else this.renderer.removeClass(img, 'is-no-photo');
    if (img.getAttribute('src') === value) return;
    if (value) this.renderer.setAttribute(img, 'src', value);
    else this.renderer.removeAttribute(img, 'src');
  }

  private release(): void {
    this.subscription?.unsubscribe();
    this.lease?.release();
    this.subscription = undefined;
    this.lease = undefined;
  }
}
