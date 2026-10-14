import { Directive, ElementRef, HostListener, Input, OnChanges, OnDestroy, Renderer2 } from '@angular/core';
import { Subscription } from 'rxjs';
import { ImageLease, StoredImageService } from '../core/services/stored-image.service';

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
