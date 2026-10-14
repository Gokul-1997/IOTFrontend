import { DestroyRef, Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, defer, finalize, shareReplay, takeUntil, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const TTL_MS = 5 * 60_000;
const PATHS = {
  charts: '/charts/meta', oee: '/oee/meta', machines: '/master/machines',
  masterShifts: '/master/shifts', shifts: '/shifts', lines: '/lines', plants: '/master/plants', programMachines: '/programs/machines'
} as const;
type Key = keyof typeof PATHS;
type Entry = { response: Observable<any>; expires: number; received: boolean };

/** Small, session-scoped reference lists. Live readings and reports are never cached here. */
@Injectable({ providedIn: 'root' })
export class MasterDataService {
  private readonly entries = new Map<Key, Entry>();
  private readonly invalidated$ = new Subject<void>();
  private version: number;

  constructor(private http: HttpClient, private auth: AuthService) {
    this.version = auth.sessionVersion;
    const subscriptions = [
      auth.sessionChanged$.subscribe(() => this.invalidate()),
      auth.grantsChanged$.subscribe(() => this.invalidate())
    ];
    inject(DestroyRef).onDestroy(() => {
      subscriptions.forEach(s => s.unsubscribe());
      this.invalidate();
      this.invalidated$.complete();
    });
  }

  get(key: Key): Observable<any> {
    // Resolve on subscription: an observable held across sign-out must use the new session.
    return defer(() => {
      if (this.version !== this.auth.sessionVersion) this.invalidate();
      const cached = this.entries.get(key);
      if (cached && (!cached.received || cached.expires > Date.now())) return cached.response;
      const entry: Entry = { response: undefined!, expires: 0, received: false };
      entry.response = this.http.get<any>(environment.apiUrl + PATHS[key]).pipe(
        takeUntil(this.invalidated$),
        tap(() => { entry.received = true; entry.expires = Date.now() + TTL_MS; }),
        finalize(() => {
          // Failed or abandoned requests must be retried, never cached as an empty answer.
          if (!entry.received && this.entries.get(key) === entry) this.entries.delete(key);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
      this.entries.set(key, entry);
      return entry.response;
    });
  }

  invalidate(): void {
    this.entries.clear();
    this.version = this.auth.sessionVersion;
    this.invalidated$.next();
  }
}
