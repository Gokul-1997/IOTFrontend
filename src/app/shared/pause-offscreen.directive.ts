import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy } from '@angular/core';

/*
 * <div appPauseOffscreen> … </div>
 *
 * Marks its host `is-paused` while it is scrolled out of view or its browser
 * tab is hidden, so the CSS animations inside it stop instead of running for
 * nobody — a dashboard is often left open all shift, on a phone or a low-end
 * PC. The pausing itself is one line of the page's CSS:
 *
 *   .is-paused .turning { animation-play-state: paused; }
 *
 * Deliberately not an IntersectionObserver. In Chromium any observer on the
 * page sends every frame of a running CSS animation through the main thread
 * (measured on this screen: 120 style recalculations a second with one, none
 * without), so the pause would cost more than the animation it pauses.
 * Instead the position is checked only when something can change it: a
 * scroll, a resize, the page growing or shrinking as cards above it load,
 * the tab being hidden or shown. At most once a frame, outside Angular, with
 * no change detection.
 */
@Directive({ selector: '[appPauseOffscreen]', standalone: true })
export class PauseOffscreenDirective implements AfterViewInit, OnDestroy {
  private frame = 0;
  private sizes?: ResizeObserver;
  private readonly check = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.update(); });
  };

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      // capture: a scroll does not bubble, and any scrolling box can move the host
      document.addEventListener('scroll', this.check, { capture: true, passive: true });
      window.addEventListener('resize', this.check, { passive: true });
      document.addEventListener('visibilitychange', this.check);
      if (typeof ResizeObserver !== 'undefined') {
        this.sizes = new ResizeObserver(this.check);
        this.sizes.observe(document.documentElement);
        const parent = this.host.nativeElement.parentElement;
        if (parent) this.sizes.observe(parent);
      }
      this.check();
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.sizes?.disconnect();
    document.removeEventListener('scroll', this.check, { capture: true });
    window.removeEventListener('resize', this.check);
    document.removeEventListener('visibilitychange', this.check);
  }

  /** On screen means any part of the host inside the window. */
  private update(): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    this.host.nativeElement.classList.toggle('is-paused', !onScreen || document.hidden);
  }
}
