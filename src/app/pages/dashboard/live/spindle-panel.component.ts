import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import { BehaviorSubject, Subscription, catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { DashboardService } from '../dashboard.service';
import { MetricHelpComponent } from '../../../shared/metric-help/metric-help.component';
import { StateComponent } from '../../../shared/state/state.component';
import { SEVERITY } from '../../../shared/severity';

/*
 * Spindle load, spindle speed and feed rate on the machine page: what they
 * are now, and how they moved over a range the viewer picks.
 *
 * It replaced two needle dials that showed one number each with no time, no
 * history and no sign of whether the reading was current. Now:
 *
 *   - three cards with the current value, its unit, when it was taken and,
 *     where a reference exists, how it compares (load against the 80 % and
 *     100 % bands; speed against the machine's rated top speed);
 *   - one trend chart (average and highest per interval) for the metric
 *     chosen, over 15 minutes to 24 hours, with the thresholds drawn on it;
 *   - the minimum, average and highest over that range, worked out while the
 *     spindle was turning, and how much of that time the load was high.
 *
 * Load and feed come from the live feed (socket) while it is current; speed
 * is not in the live feed, so it comes from the readings API, refreshed
 * every 30 s. Nothing here is a target — the controllers send no programmed
 * feed, commanded speed or override %, and the screen says so.
 */

type RangeKey = '15m' | '1h' | '4h' | '12h' | '24h';
type Metric = 'load' | 'rpm' | 'feed';

interface SpindlePoint {
  t: number; load_avg: number | null; load_max: number | null; rpm_avg: number | null; rpm_max: number | null;
  feed_avg: number | null; feed_max: number | null; samples: number;
}
interface SpindleData {
  machine: { id: number; serial: string; rated_rpm: number | null };
  range: { key: RangeKey; from: number; to: number; bucket_seconds: number };
  thresholds: { load_high: number; load_overload: number };
  latest: { at: number; load: number | null; rpm: number | null; feed: number | null; status: string | null; stale: boolean } | null;
  points: SpindlePoint[];
  summary: {
    samples: number; turning: number; first_at: number | null; last_at: number | null;
    load: { min: number | null; avg: number | null; max: number | null; high_pct: number | null; overload_pct: number | null };
    rpm: { min: number | null; avg: number | null; max: number | null; max_of_rated_pct: number | null };
    feed: { min: number | null; avg: number | null; max: number | null; feeding: number };
  };
}

const POLL_MS = 30_000;
/** Live values older than this are not "now" (the machine list's offline rule). */
const LIVE_MS = 60_000;
const RANGES: { key: RangeKey; label: string; long: string }[] = [
  { key: '15m', label: '15 min', long: 'the last 15 minutes' },
  { key: '1h',  label: '1 hour', long: 'the last hour' },
  { key: '4h',  label: '4 hours', long: 'the last 4 hours' },
  { key: '12h', label: '12 hours', long: 'the last 12 hours' },
  { key: '24h', label: '24 hours', long: 'the last 24 hours' }
];
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'load', label: 'Spindle load', unit: '%' },
  { key: 'rpm',  label: 'Spindle speed', unit: 'rpm' },
  { key: 'feed', label: 'Feed rate', unit: 'mm/min' }
];

const n0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const dayClock = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** A round top for an axis and how many ticks reach it: 182 → 200 in 5 steps of 40. */
export function niceScale(top: number): { max: number; ticks: number } {
  if (!(top > 0)) return { max: 1, ticks: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(top)));
  // the smallest round step (never under 1: every reading here is a whole number) that needs at most six ticks
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map(f => f * mag).filter(st => st >= 1);
  for (const step of steps) {
    const ticks = Math.ceil(top / step - 1e-9);
    if (ticks <= 6) return { max: step * ticks, ticks };
  }
  return { max: Math.ceil(top / (10 * mag)) * 10 * mag, ticks: Math.ceil(top / (10 * mag)) };
}

@Component({
  selector: 'app-spindle-panel',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule, MetricHelpComponent, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .sp-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem .75rem; margin-bottom: .75rem; }
    .sp-title { margin: 0; font-size: var(--fs-card-title, .9375rem); font-weight: 700; color: var(--mexa-ink); }
    .sp-cards { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr)); margin-bottom: 1rem; }
    .sp-card { border: 1px solid var(--mexa-rule); border-radius: 12px; padding: .75rem .9rem; background: var(--mexa-card); min-width: 0; }
    .sp-card-label { display: flex; align-items: center; gap: .25rem; margin: 0; font-size: var(--fs-label, .8125rem); font-weight: 600; color: var(--mexa-ink-2); }
    .sp-value { margin: .2rem 0 0; font-size: 1.75rem; font-weight: 700; line-height: 1.15; color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .sp-value small { font-size: .9rem; font-weight: 600; color: var(--mexa-ink-2); margin-left: .3rem; }
    .sp-value.is-missing { color: var(--mexa-ink-3); }
    .sp-band { display: inline-flex; align-items: center; gap: .25rem; margin-left: .4rem; vertical-align: middle; }
    .sp-meter { position: relative; height: 8px; border-radius: 999px; background: var(--mexa-row-alt); margin: .55rem 0 .35rem; overflow: visible; }
    .sp-meter > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--bar, #2b3990); max-width: 100%; }
    .sp-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--mark, #94a3b8); }
    .sp-scale { position: relative; height: 14px; font-size: 11px; color: var(--mexa-ink-3); font-variant-numeric: tabular-nums; }
    .sp-scale > span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .sp-scale > span:first-child { transform: none; }
    .sp-scale > span:last-child { transform: translateX(-100%); }
    .sp-note { margin: .35rem 0 0; font-size: var(--fs-small, .75rem); line-height: 1.45; color: var(--mexa-ink-3); }
    .sp-at { display: flex; align-items: center; gap: .25rem; margin: .35rem 0 0; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); }
    .sp-at.is-stale { color: #b45309; font-weight: 600; }
    :host-context(.dark) .sp-at.is-stale { color: #f7c667; }
    .sp-at .material-icons { font-size: 14px; }
    .sp-chartbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .25rem; }
    .sp-stats { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); margin: .5rem 0 0; }
    .sp-stat { border-radius: 10px; background: var(--mexa-row-alt); padding: .5rem .7rem; }
    .sp-stat dt { margin: 0; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); font-weight: 600; }
    .sp-stat dd { margin: .1rem 0 0; font-size: 1.05rem; font-weight: 700; color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .sp-stat dd small { font-size: .75rem; font-weight: 600; color: var(--mexa-ink-2); margin-left: .2rem; }
    .sp-basis { margin: .5rem 0 0; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); }
    .mexa-seg button { min-height: 32px; padding: .25rem .7rem; font-size: .78rem; }
    /* five ranges on a 360px phone: tighter buttons, and the strip scrolls rather than pushing the page */
    .mexa-seg { max-width: 100%; overflow-x: auto; }
    @media (max-width: 400px) { .mexa-seg button { padding: .25rem .45rem; } }
    @media (pointer: coarse) { .mexa-seg button { min-height: 40px; } }
  `],
  template: `
    <section class="mexa-lift rounded-xl p-4" aria-labelledby="spTitle">
      <div class="sp-head">
        <h2 id="spTitle" class="sp-title">Spindle and feed</h2>
        <!-- the range for the chart and the figures under it -->
        <div class="mexa-seg" role="group" aria-label="Time range">
          <button type="button" *ngFor="let r of ranges" [attr.aria-pressed]="range === r.key" (click)="setRange(r.key)">{{ r.label }}</button>
        </div>
      </div>

      <!-- ── now ── -->
      <div class="sp-cards">
        <article class="sp-card" *ngIf="showLoad" aria-labelledby="spLoadLabel">
          <p class="sp-card-label" id="spLoadLabel">Spindle load <app-metric-help topic="spindle_load"></app-metric-help></p>
          <p class="sp-value" [class.is-missing]="now.load === null">
            {{ now.load === null ? '--' : fmt0(now.load) }}<small *ngIf="now.load !== null">%</small>
            <span *ngIf="now.load !== null" class="mexa-badge sp-band" [ngClass]="band(now.load).badge">
              <span class="material-icons" aria-hidden="true">{{ band(now.load).icon }}</span>{{ band(now.load).label }}
            </span>
          </p>
          <div class="sp-meter" aria-hidden="true">
            <i [style.width.%]="pctOf(now.load, 150)" [style.--bar]="band(now.load ?? 0).color"></i>
            <span class="sp-mark" [style.left.%]="pctOf(80, 150)" style="--mark:#d97706"></span>
            <span class="sp-mark" [style.left.%]="pctOf(100, 150)" style="--mark:#dc2626"></span>
          </div>
          <div class="sp-scale" aria-hidden="true">
            <span style="left:0">0</span><span [style.left.%]="pctOf(80, 150)">80%</span><span [style.left.%]="pctOf(100, 150)">100%</span><span style="left:100%">150%</span>
          </div>
          <p class="sp-note">Normal up to 80 %, high 80–100 %, overload above 100 %.</p>
          <p class="sp-at" [class.is-stale]="now.stale"><span class="material-icons" aria-hidden="true">{{ now.stale ? 'history' : 'schedule' }}</span>{{ asOf }}</p>
        </article>

        <article class="sp-card" *ngIf="showLoad" aria-labelledby="spRpmLabel">
          <p class="sp-card-label" id="spRpmLabel">Spindle speed <app-metric-help topic="spindle_speed"></app-metric-help></p>
          <p class="sp-value" [class.is-missing]="now.rpm === null">
            {{ now.rpm === null ? '--' : fmt0(now.rpm) }}<small *ngIf="now.rpm !== null">rpm</small>
          </p>
          <ng-container *ngIf="rated; else noRated">
            <div class="sp-meter" aria-hidden="true">
              <i [style.width.%]="pctOf(now.rpm, rated)" style="--bar:#2b3990"></i>
            </div>
            <div class="sp-scale" aria-hidden="true"><span style="left:0">0</span><span style="left:100%">Rated {{ fmt0(rated) }} rpm</span></div>
            <p class="sp-note">{{ now.rpm === null ? 'Rated top speed ' + fmt0(rated) + ' rpm.' : fmt1(pctOf(now.rpm, rated)) + ' % of the rated ' + fmt0(rated) + ' rpm.' }}</p>
          </ng-container>
          <ng-template #noRated>
            <p class="sp-note">The rated top speed is not set in the machine register, so the speed cannot be compared with it.</p>
          </ng-template>
          <p class="sp-at" [class.is-stale]="speedStale"><span class="material-icons" aria-hidden="true">{{ speedStale ? 'history' : 'schedule' }}</span>{{ speedAsOf }}</p>
        </article>

        <article class="sp-card" *ngIf="showFeed" aria-labelledby="spFeedLabel">
          <p class="sp-card-label" id="spFeedLabel">Feed rate <app-metric-help topic="feed_rate"></app-metric-help></p>
          <p class="sp-value" [class.is-missing]="now.feed === null">
            {{ now.feed === null ? '--' : fmt0(now.feed) }}<small *ngIf="now.feed !== null">mm/min</small>
          </p>
          <p class="sp-note">The actual feed, rapid moves included. The controller does not send the programmed feed or the feed override %.</p>
          <p class="sp-at" [class.is-stale]="now.stale"><span class="material-icons" aria-hidden="true">{{ now.stale ? 'history' : 'schedule' }}</span>{{ asOf }}</p>
        </article>
      </div>

      <!-- ── over time ── -->
      <div class="sp-chartbar">
        <div class="mexa-seg" role="group" aria-label="Show on the chart">
          <button type="button" *ngFor="let m of visibleMetrics" [attr.aria-pressed]="metric === m.key" (click)="setMetric(m.key)">{{ m.label }}</button>
        </div>
        <span class="sp-basis" *ngIf="data?.summary?.samples">{{ rangeLong }}</span>
      </div>

      <app-state *ngIf="state === 'loading' && !data" kind="loading" title="Loading the spindle readings…"></app-state>
      <app-state *ngIf="state === 'error'" kind="error" title="Could not load the spindle readings"
        text="Check the connection, then try again. The current values above still update." action="Try again" (act)="reload()"></app-state>

      <ng-container *ngIf="state !== 'error' && data">
        <app-state *ngIf="!data.summary.samples" kind="empty" icon="sensors_off"
          [title]="'No readings from this machine in ' + rangeLong"
          [text]="range === '24h' ? 'Check that the machine is switched on and connected to the network.' : 'It may have been switched off. Look at a longer range.'"
          [action]="range === '24h' ? '' : 'Show the last 24 hours'" (act)="setRange('24h')"></app-state>

        <ng-container *ngIf="data.summary.samples">
          <div role="img" [attr.aria-label]="chartLabel">
            <apx-chart [series]="chart.series" [chart]="chart.chart" [colors]="chart.colors" [stroke]="chart.stroke"
              [xaxis]="chart.xaxis" [yaxis]="chart.yaxis" [annotations]="chart.annotations" [legend]="chart.legend"
              [tooltip]="chart.tooltip" [grid]="chart.grid" [dataLabels]="chart.dataLabels" [markers]="chart.markers"></apx-chart>
          </div>

          <!-- the figures behind the chart, over the time the spindle turned -->
          <dl class="sp-stats">
            <ng-container *ngIf="metric === 'load'">
              <div class="sp-stat"><dt>Lowest</dt><dd>{{ stat(data.summary.load.min) }}<small>%</small></dd></div>
              <div class="sp-stat"><dt>Average</dt><dd>{{ stat(data.summary.load.avg, 1) }}<small>%</small></dd></div>
              <div class="sp-stat"><dt>Highest</dt><dd>{{ stat(data.summary.load.max) }}<small>%</small></dd></div>
              <div class="sp-stat"><dt>High (80 % or more)</dt><dd>{{ stat(data.summary.load.high_pct, 1) }}<small>% of the time</small></dd></div>
              <div class="sp-stat"><dt>Overload (over 100 %)</dt><dd>{{ stat(data.summary.load.overload_pct, 1) }}<small>% of the time</small></dd></div>
            </ng-container>
            <ng-container *ngIf="metric === 'rpm'">
              <div class="sp-stat"><dt>Lowest</dt><dd>{{ stat(data.summary.rpm.min) }}<small>rpm</small></dd></div>
              <div class="sp-stat"><dt>Average</dt><dd>{{ stat(data.summary.rpm.avg) }}<small>rpm</small></dd></div>
              <div class="sp-stat"><dt>Highest</dt><dd>{{ stat(data.summary.rpm.max) }}<small>rpm</small></dd></div>
              <div class="sp-stat" *ngIf="rated"><dt>Highest vs rated</dt><dd>{{ stat(data.summary.rpm.max_of_rated_pct, 1) }}<small>% of {{ fmt0(rated) }}</small></dd></div>
            </ng-container>
            <ng-container *ngIf="metric === 'feed'">
              <div class="sp-stat"><dt>Lowest</dt><dd>{{ stat(data.summary.feed.min) }}<small>mm/min</small></dd></div>
              <div class="sp-stat"><dt>Average</dt><dd>{{ stat(data.summary.feed.avg) }}<small>mm/min</small></dd></div>
              <div class="sp-stat"><dt>Highest (rapids included)</dt><dd>{{ stat(data.summary.feed.max) }}<small>mm/min</small></dd></div>
            </ng-container>
          </dl>
          <p class="sp-basis">{{ basis }}</p>
        </ng-container>
      </ng-container>
    </section>
  `
})
export class SpindlePanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) machineId!: number;
  /** From the live feed: the latest load and feed, and when they arrived (epoch ms; 0 = nothing yet). */
  @Input() liveLoad: number | null = null;
  @Input() liveFeed: number | null = null;
  @Input() liveAt = 0;
  /** The page's widget grants: load and speed (spindle chart), feed (feed chart). */
  @Input() showLoad = true;
  @Input() showFeed = true;

  readonly ranges = RANGES;
  range: RangeKey = '1h';
  metric: Metric = 'load';
  data: SpindleData | null = null;
  state: 'loading' | 'ready' | 'error' = 'loading';

  private range$ = new BehaviorSubject<RangeKey>(this.range);
  private sub?: Subscription;
  private chartCache: any = null;

  constructor(private api: DashboardService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    if (!this.showLoad) this.metric = 'feed';
    // a new range loads at once; the same range refreshes every 30 s
    this.sub = this.range$.pipe(
      switchMap(r => interval(POLL_MS).pipe(startWith(0), map(() => r))),
      switchMap(r => this.api.getMachineSpindle(this.machineId, r).pipe(
        map((res: any) => ({ ok: res?.status === 'success', data: res?.data as SpindleData })),
        catchError(() => of({ ok: false, data: null as any })))))
      .subscribe(({ ok, data }) => {
        if (ok && data) { this.data = data; this.state = 'ready'; }
        else this.state = 'error';
        this.chartCache = null;
        this.cdr.markForCheck();
      });
  }

  ngOnChanges(ch: SimpleChanges): void {
    // live values move the cards, not the chart
    if (ch['liveLoad'] || ch['liveFeed'] || ch['liveAt']) this.cdr.markForCheck();
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  setRange(r: RangeKey): void {
    if (r === this.range) return;
    this.range = r;
    this.state = 'loading';
    this.range$.next(r);
  }

  setMetric(m: Metric): void { this.metric = m; this.chartCache = null; }

  reload(): void { this.state = 'loading'; this.range$.next(this.range); }

  /* ── the current values ── */

  private get liveFresh(): boolean { return !!this.liveAt && Date.now() - this.liveAt < LIVE_MS; }

  /** What the cards show: the live feed while it is current, else the latest stored reading if it is. */
  get now(): { load: number | null; feed: number | null; rpm: number | null; at: number | null; stale: boolean } {
    const l = this.data?.latest;
    const fresh = this.liveFresh;
    const stored = l && !l.stale ? l : null;
    return {
      load: fresh ? this.liveLoad : stored ? stored.load : null,
      feed: fresh ? this.liveFeed : stored ? stored.feed : null,
      rpm: stored ? stored.rpm : null,
      at: fresh ? this.liveAt : l ? l.at : null,
      stale: !fresh && !stored
    };
  }

  get asOf(): string {
    const n = this.now;
    if (!n.at) return this.state === 'loading' ? 'Waiting for the first reading…' : 'No reading in the last 24 hours';
    return n.stale ? `No reading since ${dayClock.format(n.at)}` : `As of ${clock.format(n.at)}`;
  }

  get speedStale(): boolean { const l = this.data?.latest; return !l || l.stale; }

  get speedAsOf(): string {
    const l = this.data?.latest;
    if (!l) return this.state === 'loading' ? 'Waiting for the first reading…' : 'No reading in the last 24 hours';
    return l.stale ? `No reading since ${dayClock.format(l.at)}` : `As of ${clock.format(l.at)}`;
  }

  get rated(): number | null { return this.data?.machine?.rated_rpm ?? null; }

  band(load: number): { label: string; icon: string; color: string; badge: string } {
    if (load > 100) return { label: 'Overload', icon: SEVERITY.critical.icon, color: SEVERITY.critical.color, badge: 'mexa-badge-bad' };
    if (load >= 80) return { label: 'High', icon: SEVERITY.noncritical.icon, color: SEVERITY.noncritical.color, badge: 'mexa-badge-warn' };
    return { label: 'Normal', icon: 'check_circle', color: '#15803d', badge: 'mexa-badge-good' };
  }

  pctOf(v: number | null, of: number): number { return v === null || !of ? 0 : Math.max(0, Math.min(100, (v / of) * 100)); }
  fmt0(v: number): string { return n0.format(v); }
  fmt1(v: number): string { return n1.format(v); }
  stat(v: number | null, digits = 0): string { return v === null || v === undefined ? '--' : (digits ? n1 : n0).format(v); }

  get visibleMetrics() {
    return METRICS.filter(m => (m.key === 'feed' ? this.showFeed : this.showLoad));
  }

  get rangeLong(): string { return RANGES.find(r => r.key === this.range)!.long; }

  /** "Worked out from 5,787 readings while the spindle turned, 3:58 pm – 8:28 pm." */
  get basis(): string {
    const s = this.data?.summary;
    if (!s?.samples) return '';
    const span = s.first_at && s.last_at ? `, ${dayClock.format(s.first_at)} – ${dayClock.format(s.last_at)}` : '';
    if (this.metric === 'feed') return `From ${n0.format(s.feed.feeding)} readings while the axes were moving${span}.`;
    if (!s.turning) return `The spindle did not turn in ${this.rangeLong}${span}.`;
    return `From ${n0.format(s.turning)} readings while the spindle was turning${span}. Each point on the chart is one ${this.bucketWords}.`;
  }

  private get bucketWords(): string {
    const b = this.data?.range.bucket_seconds || 60;
    return b < 60 ? `${b}-second interval` : `${b / 60}-minute interval`;
  }

  get chartLabel(): string {
    const m = METRICS.find(x => x.key === this.metric)!;
    return `${m.label} over ${this.rangeLong}: average and highest in each interval, in ${m.unit}.`;
  }

  /* ── the chart ── */

  get chart(): any {
    if (this.chartCache) return this.chartCache;
    const d = this.data!;
    const dark = document.documentElement.classList.contains('dark');
    const ink = dark ? '#c7cbd6' : '#4b5262';
    const m = METRICS.find(x => x.key === this.metric)!;
    const avgKey = `${this.metric}_avg` as keyof SpindlePoint;
    const maxKey = `${this.metric}_max` as keyof SpindlePoint;

    // every interval of the range, so a stop shows as a gap, not a straight line across it
    const step = d.range.bucket_seconds * 1000;
    const byT = new Map(d.points.map(p => [p.t, p]));
    const avg: [number, number | null][] = [];
    const max: [number, number | null][] = [];
    for (let t = Math.floor(d.range.from / step) * step; t <= d.range.to; t += step) {
      const p = byT.get(t);
      avg.push([t, p ? (p[avgKey] as number | null) : null]);
      max.push([t, p ? (p[maxKey] as number | null) : null]);
    }

    const lines: any[] = [];
    if (this.metric === 'load') {
      lines.push({ y: d.thresholds.load_high, borderColor: SEVERITY.noncritical.color, strokeDashArray: 4,
                   label: { text: `High ${d.thresholds.load_high} %`, position: 'left', textAnchor: 'start', offsetX: 4, borderWidth: 0,
                            style: { background: SEVERITY.noncritical.color, color: '#fff', fontSize: '11px' } } });
      lines.push({ y: d.thresholds.load_overload, borderColor: SEVERITY.critical.color, strokeDashArray: 4,
                   label: { text: `Overload ${d.thresholds.load_overload} %`, borderWidth: 0, style: { background: SEVERITY.critical.color, color: '#fff', fontSize: '11px' } } });
    }
    if (this.metric === 'rpm' && this.rated) {
      lines.push({ y: this.rated, borderColor: '#64748b', strokeDashArray: 4,
                   label: { text: `Rated ${n0.format(this.rated)} rpm`, borderWidth: 0, style: { background: '#64748b', color: '#fff', fontSize: '11px' } } });
    }
    const top = Math.max(...max.map(x => x[1] ?? 0), ...lines.map(l => l.y), 1);
    const scale = niceScale(top * 1.05);

    const fmtY = (v: number) => (v === null || v === undefined ? '' : n0.format(v));
    this.chartCache = {
      series: [{ name: 'Average', data: avg }, { name: 'Highest', data: max }],
      chart: { type: 'line', height: 240, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false },
               fontFamily: 'inherit', foreColor: ink },
      colors: ['#2b3990', '#9b7ec8'],
      stroke: { width: [2.5, 1.5], curve: 'straight', dashArray: [0, 4] },
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '12px', markers: { size: 5 } },
      grid: { borderColor: dark ? 'rgba(148,163,184,.18)' : 'rgba(148,163,184,.3)', padding: { right: 12 } },
      xaxis: { type: 'datetime', min: d.range.from, max: d.range.to,
               labels: { datetimeUTC: false, hideOverlappingLabels: true,
                         datetimeFormatter: { hour: 'h TT', minute: 'h:mm TT' } },
               tooltip: { enabled: false } },
      yaxis: { min: 0, max: scale.max, tickAmount: scale.ticks,
               title: { text: m.unit === '%' ? 'Load (%)' : m.unit, style: { fontSize: '11px', fontWeight: 600 } },
               labels: { formatter: fmtY } },
      annotations: { yaxis: lines },
      tooltip: { shared: true, x: { format: 'd MMM, h:mm TT' },
                 y: { formatter: (v: number | null) => (v === null || v === undefined ? 'no reading' : `${n0.format(v)} ${m.unit}`) } }
    };
    return this.chartCache;
  }
}
