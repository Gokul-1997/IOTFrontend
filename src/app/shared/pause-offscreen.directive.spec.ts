import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRef, NgZone } from '@angular/core';
import { PauseOffscreenDirective } from './pause-offscreen.directive';

const zone = { runOutsideAngular: (fn: () => unknown) => fn() } as unknown as NgZone;

describe('PauseOffscreenDirective', () => {
  let host: HTMLElement;
  let d: PauseOffscreenDirective;
  let hidden = false;
  let rect = { top: 100, bottom: 300, left: 0, right: 400 };
  let frames: FrameRequestCallback[] = [];

  /* the frame the directive waits for, run by hand */
  const nextFrame = () => { const run = frames; frames = []; run.forEach(f => f(0)); };
  const paused = () => host.classList.contains('is-paused');

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    hidden = false;
    rect = { top: 100, bottom: 300, left: 0, right: 400 };
    host = document.createElement('div');
    document.body.appendChild(host);
    host.getBoundingClientRect = () => rect as DOMRect;
    d = new PauseOffscreenDirective(new ElementRef(host), zone);
    d.ngAfterViewInit();
    nextFrame();
  });

  afterEach(() => {
    d.ngOnDestroy();
    host.remove();
    vi.unstubAllGlobals();
  });

  it('runs while on screen', () => {
    expect(paused()).toBe(false);
  });

  it('pauses once scrolled out of view, and runs again once back', () => {
    rect = { top: -500, bottom: -10, left: 0, right: 400 };
    document.dispatchEvent(new Event('scroll'));
    nextFrame();
    expect(paused()).toBe(true);

    rect = { top: 700, bottom: 900, left: 0, right: 400 };   // its top edge showing
    window.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(paused()).toBe(false);
  });

  it('a scroll inside any box counts, not only the window', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    rect = { top: 900, bottom: 1100, left: 0, right: 400 };
    box.dispatchEvent(new Event('scroll'));   // does not bubble; seen through capture
    nextFrame();
    expect(paused()).toBe(true);
    box.remove();
  });

  it('pauses while the tab is hidden, even when on screen', () => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    nextFrame();
    expect(paused()).toBe(true);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    nextFrame();
    expect(paused()).toBe(false);
  });

  it('a burst of scroll events is measured once a frame', () => {
    const measure = vi.spyOn(host, 'getBoundingClientRect');
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('scroll'));
    nextFrame();
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the page goes', () => {
    d.ngOnDestroy();
    rect = { top: -500, bottom: -10, left: 0, right: 400 };
    document.dispatchEvent(new Event('scroll'));
    nextFrame();
    expect(paused()).toBe(false);
  });
});
