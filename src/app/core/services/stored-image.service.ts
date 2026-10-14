import { DestroyRef, Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CACHE_BYTES = 10 * 1024 * 1024;
const CACHE_ENTRIES = 24;
const RECHECK_MS = 60_000;
const FILE_PATH = /^\/api\/files\/companies\/([1-9]\d*)\/images\/machines\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;

type Entry = {
  url: string;
  source: BehaviorSubject<string | null>;
  request?: Subscription;
  objectUrl?: string;
  bytes: number;
  refs: number;
  touched: number;
  received: number;
};
export type ImageLease = { source$: Observable<string | null>; release: () => void };

/** Private images use the normal authenticated API. Only unused images are
 * retained in the small cache; visible images keep their URL until released. */
@Injectable({ providedIn: 'root' })
export class StoredImageService {
  private readonly entries = new Map<string, Entry>();
  private version: number;
  private revision: unknown;

  constructor(private http: HttpClient, private auth: AuthService) {
    this.version = auth.sessionVersion;
    this.revision = auth.getUser()?.auth_revision;
    const subscriptions = [
      auth.sessionChanged$.subscribe(() => this.invalidate()),
      auth.grantsChanged$.subscribe(() => this.invalidate(true)),
      auth.authorizationRevisionChanged$.subscribe(() => this.invalidate(true))
    ];
    inject(DestroyRef).onDestroy(() => {
      subscriptions.forEach(subscription => subscription.unsubscribe());
      this.invalidate();
    });
  }

  /** Resolve only the canonical file route on this API, never a similar URL
   * on another server. Credentials must never follow legacy external images. */
  protectedUrl(value: string): string | null {
    const api = new URL(environment.apiUrl, window.location.origin);
    let path = value;
    if (!value.startsWith('/')) {
      try {
        const candidate = new URL(value);
        if (candidate.origin !== api.origin || candidate.search || candidate.hash || candidate.username || candidate.password) return null;
        path = candidate.pathname;
      } catch { return null; }
    }
    const match = FILE_PATH.exec(path);
    if (!match || Number(match[1]) !== Number(this.auth.getCompanyId())) return null;
    return environment.apiUrl.replace(/\/$/, '') + path.slice('/api'.length);
  }

  acquire(url: string): ImageLease {
    if (this.protectedUrl(url) !== url) return { source$: of(null), release: () => {} };
    if (this.version !== this.auth.sessionVersion || this.revision !== this.auth.getUser()?.auth_revision) this.invalidate();
    let entry = this.entries.get(url);
    if (entry && !entry.refs && Date.now() - entry.received > RECHECK_MS) {
      this.drop(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = { url, source: new BehaviorSubject<string | null>(null), bytes: 0, refs: 0, touched: Date.now(), received: 0 };
      this.entries.set(url, entry);
    }
    entry.refs++;
    entry.touched = Date.now();
    if (!entry.objectUrl && !entry.request) this.load(entry);
    const held = entry;
    let released = false;
    return {
      source$: held.source.asObservable(),
      release: () => {
        if (released) return;
        released = true;
        held.refs = Math.max(0, held.refs - 1);
        held.touched = Date.now();
        if (!held.refs && !held.objectUrl) this.drop(held);
        this.trim();
      }
    };
  }

  private load(entry: Entry): void {
    entry.request = this.http.get(entry.url, { responseType: 'blob' }).subscribe({
      next: blob => {
        if (this.entries.get(entry.url) !== entry) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > MAX_IMAGE_BYTES || !blob.size) {
          entry.source.next(null);
          return;
        }
        entry.bytes = blob.size;
        entry.received = Date.now();
        entry.objectUrl = URL.createObjectURL(blob);
        entry.source.next(entry.objectUrl);
        this.trim();
      },
      error: () => { entry.request = undefined; entry.source.next(null); },
      complete: () => { entry.request = undefined; }
    });
  }

  private invalidate(reload = false): void {
    this.version = this.auth.sessionVersion;
    this.revision = this.auth.getUser()?.auth_revision;
    const visible: Entry[] = [];
    for (const entry of this.entries.values()) {
      entry.request?.unsubscribe();
      entry.request = undefined;
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      entry.objectUrl = undefined;
      entry.bytes = 0;
      entry.source.next(null);
      if (reload && this.auth.isLoggedIn() && entry.refs) visible.push(entry);
      else entry.source.complete();
    }
    this.entries.clear();
    for (const entry of visible) {
      this.entries.set(entry.url, entry);
      this.load(entry);
    }
  }

  private drop(entry: Entry): void {
    if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
    entry.request?.unsubscribe();
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entry.source.next(null);
    entry.source.complete();
  }

  private trim(): void {
    const unused = [...this.entries.values()].filter(entry => !entry.refs).sort((a, b) => a.touched - b.touched);
    let bytes = unused.reduce((total, entry) => total + entry.bytes, 0);
    let count = unused.length;
    for (const entry of unused) {
      if (bytes <= CACHE_BYTES && count <= CACHE_ENTRIES) break;
      bytes -= entry.bytes;
      count--;
      this.drop(entry);
    }
  }
}
