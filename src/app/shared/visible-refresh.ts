import { EMPTY, Observable, catchError, defer, distinctUntilChanged, filter, finalize, fromEvent, map, merge, startWith, switchMap, timeout, timer } from 'rxjs';

/** A request still open after this has hung (the server's own proxy gives up at 65 s): it is dropped as a failure. */
export const HUNG_MS = 90_000;

/**
 * Cancel hidden-page work, recover each failed refresh, and reconcile on return.
 *
 * The period's tick waits for a request still on its way; it never cuts it
 * short (27 Nov 2026: cut short and started again every period, an answer
 * slower than the period was cancelled every time — it never arrived and
 * never failed, and the Factory board said "Updating…" for ever). `refresh`
 * (new filters) does replace it: the old answer is no longer wanted.
 */
export function visibleRefresh<T>(
  request: () => Observable<T>,
  periodMs: number,
  refresh: Observable<unknown> = EMPTY,
  onError: (error: unknown) => void = () => {},
  visibility: Document = document
): Observable<T> {
  return fromEvent(visibility, 'visibilitychange').pipe(
    startWith(null),
    map(() => !visibility.hidden),
    distinctUntilChanged(),
    switchMap(visible => {
      if (!visible) return EMPTY;
      let busy = false;
      return merge(timer(0, periodMs).pipe(filter(() => !busy)), refresh).pipe(
        switchMap(() => defer(() => { busy = true; return request(); }).pipe(
          timeout({ first: HUNG_MS }),
          catchError(error => { onError(error); return EMPTY; }),
          finalize(() => { busy = false; })
        ))
      );
    })
  );
}
