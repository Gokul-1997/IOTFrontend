import { inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';

/**
 * A dashboard with charts and tables shows them on separate tabs (Charts |
 * …Details), under the KPI tiles every tab shares. The API serves its data
 * in three parts (`?part=kpis,charts,table`, Backend dashboard/parts.js):
 *
 *   kpis    the tiles above the tabs — on screen whichever tab is open
 *   charts  the Charts tab
 *   table   the tables tab
 *
 * A part is asked for only while it is on screen and out of date with the
 * filters, and what is needed at once goes in one request:
 *
 *   - opening the page asks for the tiles and the tab on show, never the other;
 *   - opening the other tab asks for its part alone, once;
 *   - paging, sorting or searching a table asks for the table (and the tiles,
 *     when the search narrows them) — never the charts;
 *   - going back to a tab that is up to date asks for nothing.
 *
 * Which filters a part depends on is the page's to say (`partKeys()`): a
 * string per part, and the part is out of date when its string changes.
 */
export type DashPart = 'kpis' | 'charts' | 'table';
export const DASH_PARTS: readonly DashPart[] = ['kpis', 'charts', 'table'];

/** One tab: its key (in the address as ?view=), its label and icon, and the parts it shows. */
export interface DashTab { key: string; label: string; icon: string; parts: DashPart[]; }

export interface DashViewHooks {
  /** What each part depends on, as a string; when one changes, that part is out of date. */
  partKeys(): Record<DashPart, string>;
  /** One request for these parts. */
  fetchParts(parts: DashPart[]): Observable<any>;
  /**
   * The answer for these parts, or null with the error when the request
   * failed. Return false when it cannot be shown, so the parts are asked for
   * again next time instead of being taken as loaded.
   */
  applyParts(parts: DashPart[], res: any | null, err?: any): boolean | void;
}

interface Request { keys: Record<DashPart, string>; parts: DashPart[]; sub: Subscription; }

export class DashViews {
  /** The tab on show. */
  tab: string;

  /** The filters each part on screen was loaded for; null when it must load again. */
  private loadedFor: Record<DashPart, string | null> = { kpis: null, charts: null, table: null };
  /** Whether a part has anything to show yet (it keeps it while newer data loads). */
  private shown: Record<DashPart, boolean> = { kpis: false, charts: false, table: false };
  private pending: Record<DashPart, Request | null> = { kpis: null, charts: null, table: null };

  constructor(private hooks: DashViewHooks, readonly tabs: DashTab[], initial?: string) {
    this.tab = tabs.some(t => t.key === initial) ? initial! : tabs[0].key;
  }

  /** The tab on show, with the parts it needs. */
  get current(): DashTab { return this.tabs.find(t => t.key === this.tab) ?? this.tabs[0]; }

  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.current.parts.some(p => !!this.pending[p]); }

  /** The part has data to show. */
  has(part: DashPart): boolean { return this.shown[part]; }

  /** Open a tab; only what it shows and is out of date is asked for. */
  show(tab: string): void {
    if (!this.tabs.some(t => t.key === tab)) return;
    this.tab = tab;
    this.load();
  }

  /**
   * Bring what is on screen up to date with the filters. A request still out
   * for filters that have since changed is dropped — the hidden tab's too —
   * so an answer that would be out of date can never land.
   */
  load(): void {
    const keys = this.hooks.partKeys();

    for (const req of new Set(DASH_PARTS.map(p => this.pending[p]))) {
      if (req && req.parts.some(p => req.keys[p] !== keys[p])) this.drop(req);
    }

    const need = this.current.parts.filter(p => this.loadedFor[p] !== keys[p] && !this.pending[p]);
    if (!need.length) return;

    const req: Request = { keys, parts: need, sub: Subscription.EMPTY };
    for (const p of need) this.pending[p] = req;
    req.sub = this.hooks.fetchParts(need).subscribe({
      next: res => {
        if (!need.every(p => this.pending[p] === req)) return;
        for (const p of need) this.pending[p] = null;
        const ok = this.hooks.applyParts(need, res) !== false;
        for (const p of need) {
          this.loadedFor[p] = ok ? keys[p] : null;
          if (ok) this.shown[p] = true;
        }
      },
      error: err => {
        if (!need.every(p => this.pending[p] === req)) return;
        for (const p of need) { this.pending[p] = null; this.loadedFor[p] = null; }
        this.hooks.applyParts(need, null, err);
      }
    });
  }

  /** The data changed under every part (a ticket raised, a rule saved): each loads again when next on screen. */
  stale(): void {
    this.loadedFor = { kpis: null, charts: null, table: null };
  }

  /** Drop every request still on its way (the page is closing). */
  cancel(): void {
    for (const req of new Set(DASH_PARTS.map(p => this.pending[p]))) if (req) this.drop(req);
  }

  private drop(req: Request): void {
    req.sub.unsubscribe();
    for (const p of req.parts) if (this.pending[p] === req) this.pending[p] = null;
  }
}

/**
 * The tab in the address — `?view=details` — so a reload or a shared link
 * opens the same tab. The address is replaced, not added to: Back leaves the
 * page rather than stepping through its tabs. The first tab is the default
 * and leaves no `view` in the address. Call it in a field initializer.
 */
export function viewInUrl(tabs: DashTab[]): { initial: string; write(tab: string): void } {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const asked = route.snapshot.queryParamMap.get('view');
  return {
    initial: tabs.some(t => t.key === asked) ? asked! : tabs[0].key,
    write: tab => {
      void router.navigate([], {
        relativeTo: route,
        queryParams: { view: tab === tabs[0].key ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  };
}

/**
 * Scroll a section into view and move focus to its heading once it is on the
 * page — after a tab switch it appears a frame or two later, so this looks
 * for it for up to half a second. A keyboard or screen-reader user lands on
 * the results too; nobody who asked for less motion gets a smooth scroll.
 */
export function revealWhenShown(sectionId: string, headingId: string): void {
  let tries = 30;
  const look = () => {
    const section = document.getElementById(sectionId);
    const heading = document.getElementById(headingId);
    if (!section || !heading) {
      if (--tries > 0) requestAnimationFrame(look);
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  };
  requestAnimationFrame(look);
}
