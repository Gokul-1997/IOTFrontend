import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Labeled, comparable measurements. Missing readings stay missing, never zero. */
@Component({
  selector: 'app-data-bars',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar-comparison" [attr.aria-label]="label">
      <div *ngFor="let value of values; let i = index" class="comparison-row">
        <div class="comparison-label"><span>{{ labels[i] || 'Reading ' + (i + 1) }}</span><strong>{{ display(value) }}</strong></div>
        <div class="comparison-track" aria-hidden="true">
          <span [style.width.%]="width(value)" [style.background]="colors[i] || 'var(--gokul-accent)' "></span>
          <i *ngIf="target !== null" [style.left.%]="width(target)"></i>
        </div>
      </div>
      <div *ngIf="target !== null" class="comparison-footnote">Target <strong>{{ display(target) }}</strong></div>
      <p *ngIf="!values.length" class="comparison-empty">No readings available for this selection.</p>
    </div>
  `,
  styles: [`
    :host { display:block; width:100%; min-width:0; }
    .bar-comparison { display:grid; gap:20px; padding:8px 0; }
    .comparison-label { display:flex; justify-content:space-between; align-items:baseline; gap:16px; margin-bottom:9px; font-size:12px; color:var(--gokul-muted); }
    .comparison-label span { overflow-wrap:anywhere; }
    .comparison-label strong { color:var(--gokul-ink); font-size:15px; font-weight:650; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .comparison-track { height:9px; background:var(--gokul-tint); border-radius:3px; position:relative; }
    .comparison-track > span { display:block; height:100%; border-radius:3px; transition:width .25s; }
    .comparison-track i { position:absolute; top:-4px; width:2px; height:17px; background:var(--gokul-ink); transform:translateX(-2px); }
    .comparison-footnote { font-size:10px; color:var(--gokul-muted); text-align:right; }
    .comparison-empty { padding:20px 0; color:var(--gokul-muted); font-size:12px; }
    @media(prefers-reduced-motion:reduce) { .comparison-track > span { transition:none; } }
  `]
})
export class DataBarsComponent {
  @Input() values: Array<number | null | undefined> = [];
  @Input() labels: string[] = [];
  @Input() colors: string[] = [];
  @Input() unit = '';
  @Input() scaleMax: number | null = null;
  @Input() target: number | null = null;
  @Input() label = 'Measurement comparison';
  @Input() duration = false;

  width(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
    const max = this.scaleMax ?? Math.max(0, ...this.values.map(v => Number(v) || 0));
    return max > 0 ? Math.max(0, Math.min(100, Number(value) / max * 100)) : 0;
  }

  display(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Not reported';
    const number = Number(value);
    if (this.duration) {
      const seconds = Math.max(0, Math.round(number));
      if (seconds < 60) return `${seconds}s`;
      return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    }
    return number.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + (this.unit === '%' ? '%' : this.unit ? ' ' + this.unit : '');
  }
}
