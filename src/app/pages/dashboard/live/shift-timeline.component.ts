import { Component, ChangeDetectionStrategy, ChangeDetectorRef, Input, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, interval, startWith, switchMap, catchError, of } from 'rxjs';
import { DashboardService } from '../dashboard.service';
import { AuthService } from '../../../core/services/auth.service';

type State = 'RUNNING' | 'IDLE' | 'ALARM' | 'OFF';
interface Seg { state: State; from: number; to: number; }
interface Brk { name: string; from: number; to: number; }

const POLL_MS = 60_000;
const COLOR: Record<State, string> = { RUNNING: '#22c55e', IDLE: '#f5a623', ALARM: '#e03131', OFF: '#94a3b8' };
const WORD: Record<State, string> = { RUNNING: 'Running', IDLE: 'Idle', ALARM: 'Alarm', OFF: 'Off' };
const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/*
 * The current shift as one bar: Running / Idle / Alarm / Off periods from
 * the machine's own samples, the shift's breaks hatched across it, and the
 * part of the shift still to come left blank. Hover (or tap) for a period's
 * length and times; with the keyboard, focus the bar and step through the
 * periods with the arrow keys — each one is read out.
 *
 * The colours are the machine list's: an Alarm period is the red card, Off
 * is the grey one.
 */
@Component({
  selector: 'app-shift-timeline',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .tl-bar { position: relative; height: 36px; border-radius: 8px; overflow: hidden; outline: none;
              background: repeating-linear-gradient(135deg, rgba(148,163,184,.14) 0 6px, rgba(148,163,184,.26) 6px 12px); }
    .tl-bar:focus-visible { box-shadow: 0 0 0 3px #2b3a8f; }
    .tl-seg { position: absolute; top: 0; bottom: 0; }
    .tl-seg + .tl-seg { box-shadow: inset 1px 0 0 rgba(255,255,255,.55); }
    .tl-seg.is-focus { box-shadow: inset 0 0 0 2px #111827; z-index: 2; }
    .tl-break { position: absolute; top: 0; bottom: 0; z-index: 1; pointer-events: none;
                background: repeating-linear-gradient(135deg, rgba(255,255,255,.62) 0 4px, rgba(255,255,255,0) 4px 9px);
                border-left: 2px solid rgba(17,24,39,.55); border-right: 2px solid rgba(17,24,39,.55); }
    .tl-now { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #111827; z-index: 3; pointer-events: none; }
    .tl-tip { position: absolute; bottom: calc(100% + 10px); transform: translateX(-50%); z-index: 5; pointer-events: none;
              white-space: nowrap; border-radius: 10px; padding: .45rem .7rem;
              background: #fff; color: #1f2430; border: 1px solid #d5d9e4; box-shadow: 0 6px 18px rgba(17,20,45,.16); }
    .tl-tip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
                     border: 7px solid transparent; border-top-color: #fff; }
    .tl-axis { position: relative; height: 18px; margin-top: 4px; }
    .tl-tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 11px; font-weight: 600;
               color: var(--mexa-ink-3, #5d6679); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tl-tick::before { content: ''; position: absolute; left: 50%; top: -4px; width: 1px; height: 4px; background: currentColor; }
    .tl-swatch { width: .75rem; height: .75rem; border-radius: 3px; flex: none; }
    .tl-swatch-break { background: repeating-linear-gradient(135deg, #cbd5e1 0 3px, #fff 3px 6px); border: 1px solid #64748b; }
    :host-context(.dark) .tl-tip { background: #1d2230; color: #e8ebf2; border-color: #353c4d; }
    :host-context(.dark) .tl-tip::after { border-top-color: #1d2230; }
    :host-context(.dark) .tl-now { background: #e8ebf2; }
    :host-context(.dark) .tl-seg.is-focus { box-shadow: inset 0 0 0 2px #fff; }
    :host-context(.dark) .tl-bar:focus-visible { box-shadow: 0 0 0 3px #9fb3ff; }
  `],
  template: `
  <section class="bg-white dark:bg-[#111111] rounded-xl p-4 shadow-xl mt-4" aria-labelledby="tlTitle">
    <h3 *ngIf="!data" id="tlTitle" class="text-base font-semibold mb-3">Shift Timeline</h3>
    <div *ngIf="loading && !data" class="h-9 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" aria-busy="true" aria-label="Loading the shift timeline"></div>
    <p *ngIf="error" class="text-sm text-red-700 dark:text-red-400" role="alert">{{ error }}</p>

    <ng-container *ngIf="data as d">
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-3">
      <h3 id="tlTitle" class="text-base font-semibold">
        Shift Timeline<span *ngIf="d.shift" class="font-normal text-gray-600 dark:text-gray-400">
          · {{ d.shift.code }} ({{ t(d.shift.start) }} – {{ t(d.shift.end) }})</span>
      </h3>
      <p *ngIf="d.totals" class="text-sm text-gray-700 dark:text-gray-300">
        Elapsed : <strong>{{ dur(d.totals.elapsed) }}</strong>
        <span class="mx-2 text-gray-300 dark:text-gray-600" aria-hidden="true">|</span>
        Break : <strong>{{ d.breaks.length ? dur(d.totals.breaks) : 'none set' }}</strong>
      </p>
    </div>

    <div *ngIf="loading && !data" class="h-9 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" aria-busy="true" aria-label="Loading the shift timeline"></div>
    <p *ngIf="error" class="text-sm text-red-700 dark:text-red-400" role="alert">{{ error }}</p>
    <p *ngIf="!d.shift" class="text-sm text-gray-600 dark:text-gray-400">No shift is running now.</p>

    <ng-container *ngIf="d.shift">
      <div class="relative pt-1">
        <div #bar class="tl-bar" tabindex="0" role="group" aria-roledescription="timeline"
             [attr.aria-label]="'Shift timeline, ' + summary + '. Use the left and right arrow keys to step through the periods.'"
             (mousemove)="onPointer($event)" (click)="onPointer($event)" (mouseleave)="clearHover()"
             (keydown)="onKey($event)" (blur)="clearHover()">
          <div *ngFor="let s of d.segments; let i = index; trackBy: bySeg" class="tl-seg"
               [class.is-focus]="i === focusIdx"
               [style.left.%]="pct(s.from)" [style.width.%]="pct(s.to) - pct(s.from)" [style.background]="color(s.state)"></div>
          <div *ngFor="let b of d.breaks" class="tl-break"
               [style.left.%]="pct(b.from)" [style.width.%]="pct(b.to) - pct(b.from)"></div>
          <div *ngIf="nowPct < 100" class="tl-now" [style.left.%]="nowPct"></div>
        </div>

        <div *ngIf="tip" class="tl-tip" [style.left.px]="tip.x" aria-hidden="true">
          <div class="flex items-center gap-2">
            <strong class="text-lg leading-none">{{ tip.len }}</strong>
            <span class="text-sm font-semibold">{{ tip.title }}</span>
          </div>
          <div class="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{{ tip.when }}</div>
          <div *ngIf="tip.note" class="text-xs font-semibold mt-0.5">{{ tip.note }}</div>
        </div>
      </div>

      <div class="tl-axis" aria-hidden="true">
        <span *ngFor="let k of axis" class="tl-tick" [ngClass]="{ 'max-md:hidden': !k.always }" [style.left.%]="k.pct">{{ k.label }}</span>
      </div>

      <!-- spoken when the keyboard steps to a period -->
      <p class="sr-only" aria-live="polite">{{ spoken }}</p>

      <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-3 text-sm text-gray-700 dark:text-gray-300">
        <span *ngFor="let s of states" class="inline-flex items-center gap-1.5">
          <i class="tl-swatch" [style.background]="color(s)" aria-hidden="true"></i>
          {{ word(s) }} <strong class="tabular-nums">{{ dur(d.totals[s]) }}</strong>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <i class="tl-swatch tl-swatch-break" aria-hidden="true"></i> Break
        </span>
      </div>

      <p *ngIf="d.breaks.length" class="text-xs text-center text-gray-600 dark:text-gray-400 mt-2">
        Breaks:
        <span *ngFor="let b of d.breaks; let last = last">{{ b.name }} {{ t(b.from) }}–{{ t(b.to) }}{{ last ? '' : ' · ' }}</span>
      </p>
      <p *ngIf="!d.breaks.length" class="text-xs text-center text-gray-600 dark:text-gray-400 mt-2">
        <ng-container *ngIf="d.breaks_configured; else notSetUp">
          No break times entered for {{ d.shift.code }}<ng-container *ngIf="canEditShifts"> —
            <a routerLink="/shifts" class="underline font-semibold">add them under Shifts</a></ng-container>.
        </ng-container>
        <ng-template #notSetUp>Break times will show here once they are set up.</ng-template>
      </p>
    </ng-container>
    </ng-container>
  </section>
  `
})
export class ShiftTimelineComponent implements OnInit, OnDestroy {
  @Input({ required: true }) machineId!: number;
  @ViewChild('bar') bar?: ElementRef<HTMLElement>;

  data: { shift: any; now: number; segments: Seg[]; breaks: Brk[]; breaks_configured: boolean; totals: any } | null = null;
  loading = true;
  error = '';
  tip: { x: number; len: string; title: string; when: string; note: string } | null = null;
  focusIdx = -1;
  spoken = '';
  axis: { pct: number; label: string; always: boolean }[] = [];
  readonly states: State[] = ['RUNNING', 'IDLE', 'ALARM', 'OFF'];
  private sub?: Subscription;

  constructor(private svc: DashboardService, private auth: AuthService, private cdr: ChangeDetectorRef) {}

  get canEditShifts(): boolean { return this.auth.hasPermission('page:shifts'); }

  ngOnInit(): void {
    this.sub = interval(POLL_MS).pipe(
      startWith(0),
      switchMap(() => this.svc.getTimeline(this.machineId).pipe(catchError(err => {
        this.error = err?.error?.message || 'Could not load the shift timeline.';
        return of(null);
      })))
    ).subscribe((res: any) => {
      this.loading = false;
      if (res?.data !== undefined) {
        this.error = '';
        this.data = res.data;
        this.axis = this.buildAxis();
        if (this.focusIdx >= (this.data?.segments.length ?? 0)) this.focusIdx = -1;
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  /* ── geometry ── */
  pct(ms: number): number {
    const s = this.data!.shift;
    return Math.min(100, Math.max(0, ((ms - s.start) / (s.end - s.start)) * 100));
  }
  get nowPct(): number { return this.data?.shift ? this.pct(this.data.now) : 100; }

  /** A label each hour; on a phone every third, so they do not collide. */
  private buildAxis(): { pct: number; label: string; always: boolean }[] {
    if (!this.data?.shift) return [];
    const { start, end } = this.data.shift;
    const out = [];
    const hours = Math.round((end - start) / 3_600_000);
    const step = hours > 12 ? 2 : 1;
    for (let h = 0; h <= hours; h += step) {
      const at = start + h * 3_600_000;
      out.push({ pct: this.pct(at), label: this.t(at).replace(':00', ''), always: h % (3 * step) === 0 });
    }
    return out;
  }

  /* ── hover / tap ── */
  onPointer(ev: MouseEvent): void {
    const el = this.bar?.nativeElement;
    if (!el || !this.data?.shift) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
    const s = this.data.shift;
    const at = s.start + (x / rect.width) * (s.end - s.start);
    const i = this.segAt(at);
    this.showTip(i, at, x, rect.width);
  }

  clearHover(): void { this.tip = null; this.focusIdx = -1; this.cdr.markForCheck(); }

  /* ── keyboard: step through the periods ── */
  onKey(ev: KeyboardEvent): void {
    const n = this.data?.segments.length ?? 0;
    if (!n) return;
    let i = this.focusIdx;
    if (ev.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
    else if (ev.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - 1);
    else if (ev.key === 'Home') i = 0;
    else if (ev.key === 'End') i = n - 1;
    else if (ev.key === 'Escape') { this.clearHover(); return; }
    else return;
    ev.preventDefault();
    const seg = this.data!.segments[i];
    const width = this.bar?.nativeElement.getBoundingClientRect().width || 0;
    const mid = (seg.from + seg.to) / 2;
    this.showTip(i, mid, (this.pct(mid) / 100) * width, width, true);
  }

  private showTip(i: number, at: number, x: number, width: number, fromKeyboard = false): void {
    const d = this.data!;
    const brk = d.breaks.find(b => at >= b.from && at < b.to);
    if (i < 0) {
      // the part of the shift still to come
      if (!brk) { this.tip = null; this.focusIdx = -1; this.cdr.markForCheck(); return; }
      this.tip = { x: this.clampX(x, width), len: this.short(brk.to - brk.from), title: brk.name,
                   when: `${this.t(brk.from)} – ${this.t(brk.to)}`, note: 'Planned break' };
      this.focusIdx = -1;
    } else {
      const seg = d.segments[i];
      this.tip = { x: this.clampX(x, width), len: this.short(seg.to - seg.from), title: this.word(seg.state),
                   when: `${this.t(seg.from)} – ${this.t(seg.to)}`,
                   note: brk ? `During ${brk.name} (${this.t(brk.from)} – ${this.t(brk.to)})` : '' };
      this.focusIdx = fromKeyboard ? i : -1;
      if (fromKeyboard) {
        this.spoken = `${this.tip.title}, ${this.dur(seg.to - seg.from)}, ${this.tip.when}.${this.tip.note ? ' ' + this.tip.note + '.' : ''} Period ${i + 1} of ${d.segments.length}.`;
      }
    }
    this.cdr.markForCheck();
  }

  /** Keep the tooltip inside the card near the bar's ends. */
  private clampX(x: number, width: number): number { return Math.min(Math.max(x, 90), Math.max(90, width - 90)); }

  /** Binary search: the period containing a moment, or -1 (still to come). */
  private segAt(at: number): number {
    const segs = this.data!.segments;
    let lo = 0, hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (at < segs[mid].from) hi = mid - 1;
      else if (at >= segs[mid].to) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  /* ── words ── */
  color(s: State): string { return COLOR[s]; }
  word(s: State): string { return WORD[s]; }
  bySeg = (_: number, s: Seg) => s.from;
  t(ms: number): string { return clock.format(new Date(ms)); }

  /** "7h 15m 20s", as the totals read. */
  dur(ms: number): string {
    const n = Math.max(0, Math.round((ms || 0) / 1000));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
  }
  /** "15m" / "1h 05m" for the tooltip's headline. */
  short(ms: number): string {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  get summary(): string {
    const tt = this.data?.totals;
    if (!tt) return '';
    return this.states.map(s => `${this.word(s)} ${this.dur(tt[s])}`).join(', ');
  }
}
