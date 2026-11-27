import { vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { HUNG_MS, visibleRefresh } from './visible-refresh';

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

  it('lets a slow answer finish: the period’s tick waits instead of cancelling it', () => {
    let calls = 0, cancelled = 0;
    const answers: Subject<number>[] = [];
    const request = () => new Observable<number>(subscriber => {
      calls++; const answer = new Subject<number>(); answers.push(answer);
      const sub = answer.subscribe(subscriber);
      return () => { cancelled++; sub.unsubscribe(); };
    });
    const values: number[] = [];
    const sub = visibleRefresh(request, 30000).subscribe(value => values.push(value));
    vi.advanceTimersByTime(65000);                     // two ticks pass while the first answer is on its way
    expect([calls, cancelled]).toEqual([1, 0]);
    answers[0].next(1); answers[0].complete();
    expect(values).toEqual([1]);
    vi.advanceTimersByTime(25000);                     // the next tick after it asks again
    expect(calls).toBe(2);
    sub.unsubscribe();
  });

  it('new filters replace the request on its way', () => {
    let calls = 0, cancelled = 0;
    const request = () => new Observable(() => { calls++; return () => { cancelled++; }; });
    const refresh = new Subject<void>();
    const sub = visibleRefresh(request, 30000, refresh).subscribe();
    vi.advanceTimersByTime(0);
    refresh.next();
    expect([calls, cancelled]).toEqual([2, 1]);
    sub.unsubscribe();
  });

  it('drops a request that has hung, as a failure, so the next tick can run', () => {
    let calls = 0;
    const errors: unknown[] = [];
    const sub = visibleRefresh(() => new Observable(() => { calls++; }), 30000, undefined, error => errors.push(error)).subscribe();
    vi.advanceTimersByTime(HUNG_MS);
    expect(errors).toHaveLength(1);
    vi.advanceTimersByTime(30000 - (HUNG_MS % 30000 || 30000) + 1);
    expect(calls).toBe(2);
    sub.unsubscribe();
  });
});
