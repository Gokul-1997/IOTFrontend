import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface HealthCheck { label: string; score: number; band: string; }
export interface MachineHealth {
  score: number;
  status: string;
  stale: boolean;
  observed_at: string;
  reported_checks: number;
  basis: string;
  checks: HealthCheck[];
}

@Component({
  selector: 'app-machine-health-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; color: var(--mexa-ink); }
    .mh-head { display: flex; align-items: flex-start; justify-content: space-between; gap: .65rem; }
    h2 { margin: 0; font-size: var(--fs-card-title, .9375rem); font-weight: 700; line-height: 1.4; }
    .mh-machine { margin: .3rem 0 0; color: var(--mexa-ink-3); font-size: .8rem; overflow-wrap: anywhere; }
    .mh-status { display: inline-flex; align-items: center; gap: .3rem; padding: .3rem .65rem; border-radius: 999px; font-size: .75rem; font-weight: 700; white-space: nowrap; background: #ecfdf5; color: #047857; }
    .mh-status.is-bad { background: #fef2f2; color: #b91c1c; }
    .mh-status svg { width: .9rem; height: .9rem; }
    .mh-main { display: grid; grid-template-columns: 132px minmax(0, 1fr); align-items: center; gap: 1rem; margin: 1.5rem 0; }
    .mh-ring { position: relative; --score-color: #059669; }
    .mh-ring.is-bad { --score-color: #dc2626; }
    .mh-ring svg { display: block; width: 100%; height: auto; }
    .mh-track { stroke: var(--mexa-rule, #e2e8f0); }
    .mh-progress { stroke: var(--score-color); }
    .mh-number { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: .1rem; font-variant-numeric: tabular-nums; }
    .mh-number strong { font-size: 2.3rem; font-weight: 750; letter-spacing: -.07em; }
    .mh-number span { margin-top: .65rem; font-size: 1rem; color: var(--mexa-ink-3); }
    .mh-caption strong { display: block; font-size: .92rem; font-weight: 650; line-height: 1.4; }
    .mh-caption p { margin: .4rem 0 0; color: var(--mexa-ink-3); font-size: .76rem; line-height: 1.55; }
    .mh-stale { color: #b45309 !important; font-weight: 600; }
    .mh-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; margin: 0 0 1rem; }
    .mh-counts > div { padding: .65rem .5rem; border: 1px solid var(--mexa-rule, #e2e8f0); border-radius: .65rem; }
    dt { display: flex; align-items: center; gap: .3rem; font-size: .7rem; color: var(--mexa-ink-3); }
    dd { margin: .3rem 0 0; font-size: 1.3rem; line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; }
    .mh-dot { width: .4rem; height: .4rem; flex: none; border-radius: 50%; background: #059669; }
    .mh-dot.normal { background: #d97706; } .mh-dot.critical { background: #dc2626; }
    .mh-foot { margin-top: auto; border-top: 1px solid var(--mexa-rule, #e2e8f0); padding-top: .85rem; }
    .mh-foot > p { margin: 0 0 .7rem; color: var(--mexa-ink-3); font-size: .7rem; line-height: 1.5; }
    summary { cursor: pointer; font-size: .78rem; font-weight: 600; }
    details > p, ul { font-size: .75rem; line-height: 1.6; color: var(--mexa-ink-3); }
    ul { list-style: none; margin: .75rem 0 0; padding: 0; }
    li { display: flex; justify-content: space-between; gap: .5rem; padding: .35rem 0; border-bottom: 1px solid var(--mexa-rule, #e2e8f0); }
    li strong { white-space: nowrap; font-weight: 600; }
    .mh-empty { padding: 2rem .5rem; text-align: center; color: var(--mexa-ink-3); font-size: .85rem; line-height: 1.6; }
    .mh-empty strong { display: block; color: var(--mexa-ink); margin-bottom: .4rem; }
    :host-context(.dark) .mh-status { background: #064e3b; color: #a7f3d0; }
    :host-context(.dark) .mh-status.is-bad { background: #7f1d1d; color: #fecaca; }
    :host-context(.dark) .mh-stale { color: #fbbf24 !important; }
    @media (max-width: 480px) { .mh-main { grid-template-columns: 112px minmax(0, 1fr); gap: .75rem; } .mh-number strong { font-size: 2rem; } }
  `],
  template: `
    <div class="mh-head">
      <div><h2 id="mtHealth">Machine Health Score</h2><p class="mh-machine">{{ machineName }}</p></div>
      @if (score !== null) {
        <span class="mh-status" [class.is-bad]="!good">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
            @if (good) { <path d="m6 10 2.5 2.5L14 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/> }
            @else { <path d="M10 5.5v5M10 14v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/> }
          </svg>{{ good ? 'Good' : 'Bad' }}
        </span>
      }
    </div>
    @if (health && score !== null) {
      <div class="mh-main">
        <div class="mh-ring" [class.is-bad]="!good" role="img" [attr.aria-label]="machineName + ' health score ' + score + ' percent, ' + (good ? 'Good' : 'Bad')">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="mh-track" cx="60" cy="60" r="49" fill="none" stroke-width="9"/>
            <circle class="mh-progress" cx="60" cy="60" r="49" fill="none" stroke-width="9" stroke-linecap="round" pathLength="100" [attr.stroke-dasharray]="score + ' 100'" transform="rotate(-90 60 60)"/>
          </svg>
          <div class="mh-number" aria-hidden="true"><strong>{{ score }}</strong><span>%</span></div>
        </div>
        <div class="mh-caption">
          <strong>{{ good ? 'Machine condition is good' : 'Machine needs attention' }}</strong>
          <p>{{ health.reported_checks }} reported checks</p>
          <p [class.mh-stale]="health.stale">{{ health.stale ? 'Last recorded' : 'Observed' }} {{ health.observed_at | date:'d MMM, h:mm a' }}</p>
        </div>
      </div>
      <dl class="mh-counts" aria-label="Reported condition checks">
        <div><dt><i class="mh-dot" aria-hidden="true"></i>Healthy</dt><dd>{{ count(100) }}</dd></div>
        <div><dt><i class="mh-dot normal" aria-hidden="true"></i>Normal</dt><dd>{{ count(50) }}</dd></div>
        <div><dt><i class="mh-dot critical" aria-hidden="true"></i>Critical</dt><dd>{{ count(0) }}</dd></div>
      </dl>
      <div class="mh-foot">
        <p>Good: 70–100% · Bad: below 70%<br>Based on reported sensors; missing readings are excluded.</p>
        <details><summary>View score breakdown</summary>
          <p>{{ health.basis }}</p>
          <ul><li *ngFor="let check of health.checks"><span>{{ check.label }}</span><strong>{{ check.score === 100 ? 'Healthy' : check.score === 50 ? 'Normal' : 'Critical' }}</strong></li></ul>
        </details>
      </div>
    } @else {
      <div class="mh-empty"><strong>Health score unavailable</strong>No usable condition readings were reported in this window.</div>
    }
  `
})
export class MachineHealthCardComponent {
  @Input() machineName = '';
  @Input() health: MachineHealth | null = null;

  get score(): number | null {
    const value = this.health?.score;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
  }
  get good(): boolean { return this.score !== null && this.score >= 70; }
  count(score: number): number { return (this.health?.checks || []).filter(check => check.score === score).length; }
}
