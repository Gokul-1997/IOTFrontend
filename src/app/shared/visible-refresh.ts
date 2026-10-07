import { EMPTY, Observable, catchError, defer, distinctUntilChanged, fromEvent, map, merge, startWith, switchMap, timer } from 'rxjs';

/** Cancel hidden-page work, recover each failed refresh, and reconcile on return. */
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
    switchMap(visible => visible ? merge(timer(0, periodMs), refresh).pipe(
      switchMap(() => defer(request).pipe(catchError(error => { onError(error); return EMPTY; })))
    ) : EMPTY)
  );
}
