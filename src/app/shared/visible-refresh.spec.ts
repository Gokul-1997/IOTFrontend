import { vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { visibleRefresh } from './visible-refresh';

describe('visibleRefresh', () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => { vi.useRealTimers(); delete (document as any).hidden; });

  it('keeps polling after a transient HTTP failure', () => {
    let calls = 0;
    const values: number[] = [];
    const errors: unknown[] = [];
    const sub = visibleRefresh(() => ++calls === 1 ? throwError(() => new Error('offline')) : of(calls), 30000,
      undefined, error => errors.push(error)).subscribe(value => values.push(value));
    vi.advanceTimersByTime(60000);
    expect(errors).toHaveLength(1);
    expect(values).toEqual([2, 3]);
    sub.unsubscribe();
  });

  it('cancels an in-flight request when hidden and fetches on return', () => {
    let calls = 0, cancelled = 0;
    const request = () => new Observable(() => { calls++; return () => { cancelled++; }; });
    const refresh = new Subject<void>();
    const sub = visibleRefresh(request, 30000, refresh).subscribe();
    vi.advanceTimersByTime(0);
    hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelled).toBe(1);
    vi.advanceTimersByTime(120000); refresh.next();
    expect(calls).toBe(1);
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(0);
    expect(calls).toBe(2);
    sub.unsubscribe();
  });
});
