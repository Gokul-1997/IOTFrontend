import { Component, ChangeDetectionStrategy, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

/** A coloured stretch of the scale, e.g. 100–150% "Overload" in red. */
export interface GaugeZone { from: number; to: number; color: string; }

/*
 * A semicircular needle gauge: a thick band (grey, with coloured zones where
 * the scale means something), a ring of minor and major ticks inside it,
 * labels outside, a tapered needle on a ringed pivot, and the reading in bold
 * underneath.
 *
 * Pure SVG — one per reading, no chart library — and the needle moves by a
 * CSS rotation, so a live update glides instead of redrawing. A reading past
 * the scale pins the needle at the end; the printed value is always the real
 * one. Colours come from the MEXA tokens, so both themes work.
 */
@Component({
  selector: 'app-needle-gauge',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .track { stroke: var(--gauge-track, #e8eaf0); }
    .tick { stroke: var(--mexa-ink-3, #5d6679); }
    .tick-major { stroke: var(--mexa-ink, #1f2430); }
    .scale { fill: var(--mexa-ink-2, #4b5262); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .needle { fill: var(--mexa-ink, #1f2430); }
    .hub-hole { fill: var(--gauge-hole, #fff); }
    .value { fill: var(--mexa-ink, #1f2430); font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .needle-turn {
      transform-box: view-box;
      transition: transform .7s cubic-bezier(.2, .8, .25, 1);
    }
    @media (prefers-reduced-motion: reduce) { .needle-turn { transition: none; } }
    :host-context(.dark) .track, :host-context([data-theme="dark"]) .track { stroke: #2a2f3b; }
    :host-context(.dark) .hub-hole, :host-context([data-theme="dark"]) .hub-hole { fill: #161a23; }
  `],
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel">
      <!-- the band: grey stretches and coloured zones, a clean gap between them -->
      <path *ngFor="let p of bandPieces" [attr.d]="arc(p.from, p.to, true)" fill="none"
            [class.track]="!p.color" [attr.stroke]="p.color" [attr.stroke-width]="BAND" stroke-linecap="butt"/>
      <path *ngIf="fill && value !== null && value > min" [attr.d]="arc(min, clamp(value))" fill="none"
            [attr.stroke]="fill" [attr.stroke-width]="BAND" stroke-linecap="butt"/>

      <!-- tick ring inside the band -->
      <line *ngFor="let t of tickMarks" [attr.x1]="t.x1" [attr.y1]="t.y1" [attr.x2]="t.x2" [attr.y2]="t.y2"
            [class.tick]="!t.major" [class.tick-major]="t.major" [attr.stroke-width]="t.major ? 2.2 : 1"
            stroke-linecap="round"/>

      <!-- labels outside the band -->
      <text *ngFor="let l of scaleLabels" class="scale" [attr.x]="l.x" [attr.y]="l.y"
            [attr.text-anchor]="l.anchor" dominant-baseline="middle">{{ l.text }}</text>

      <!-- tapered needle, drawn pointing up and turned to the reading -->
      <g class="needle-turn" [style.transform-origin]="CX + 'px ' + CY + 'px'" [style.transform]="'rotate(' + needleDeg + 'deg)'">
        <polygon class="needle" [attr.points]="needlePoints"/>
      </g>
      <circle class="needle" [attr.cx]="CX" [attr.cy]="CY" r="11"/>
      <circle class="hub-hole" [attr.cx]="CX" [attr.cy]="CY" r="5.5"/>

      <text class="value" [attr.x]="CX" [attr.y]="CY + 36" text-anchor="middle">{{ display }}</text>
    </svg>
  `
})
export class NeedleGaugeComponent implements OnChanges {
  @Input() value: number | null = null;
  @Input() min = 0;
  @Input() max = 100;
  @Input() zones: GaugeZone[] = [];
  /** Colour the band from min up to the reading (for a quantity with no good/bad zones). */
  @Input() fill: string | null = null;
  @Input() majorStep = 25;
  @Input() minorPerMajor = 5;
  @Input() tickLabel: (v: number) => string = v => String(v);
  @Input() valueText: (v: number | null) => string = v => (v === null ? '--' : String(v));
  @Input() ariaLabel = '';

  /* geometry, in view-box units */
  readonly W = 340;
  readonly H = 216;
  readonly CX = 170;
  readonly CY = 164;
  readonly R = 118;          // band centre line
  readonly BAND = 22;
  private readonly GAP_DEG = 0.9;

  clamp(v: number): number { return Math.min(this.max, Math.max(this.min, v)); }
  private frac(v: number): number { return (this.clamp(v) - this.min) / (this.max - this.min || 1); }
  private point(f: number, r: number): { x: number; y: number } {
    const a = Math.PI * (1 - f);
    return { x: this.CX + r * Math.cos(a), y: this.CY - r * Math.sin(a) };
  }

  /** The band as consecutive pieces: grey where no zone applies, the zone's
   *  colour where one does. */
  get pieces(): { from: number; to: number; color: string | null }[] {
    const out: { from: number; to: number; color: string | null }[] = [];
    let at = this.min;
    for (const z of [...this.zones].sort((a, b) => a.from - b.from)) {
      if (z.from > at) out.push({ from: at, to: z.from, color: null });
      out.push({ from: Math.max(z.from, at), to: z.to, color: z.color });
      at = Math.max(at, z.to);
    }
    if (at < this.max) out.push({ from: at, to: this.max, color: null });
    return out;
  }

  /** The band between two readings; zones are pulled in slightly at inner
   *  edges so neighbouring colours are separated by a hairline gap. */
  arc(from: number, to: number, gap = false): string {
    let a = this.frac(from), b = this.frac(to);
    if (gap) {
      const g = this.GAP_DEG / 180;
      if (a > 0) a += g / 2;
      if (b < 1) b -= g / 2;
    }
    if (b <= a) return '';
    const p = this.point(a, this.R), q = this.point(b, this.R);
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} A ${this.R} ${this.R} 0 0 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
  }

  get ticks(): { x1: number; y1: number; x2: number; y2: number; major: boolean }[] {
    const out = [];
    const minor = this.majorStep / Math.max(1, this.minorPerMajor);
    const inner = this.R - this.BAND / 2 - 6;
    for (let v = this.min, i = 0; v <= this.max + 1e-9; v += minor, i++) {
      const major = i % this.minorPerMajor === 0;
      const f = this.frac(v);
      const p = this.point(f, inner), q = this.point(f, inner - (major ? 11 : 6));
      out.push({ x1: +p.x.toFixed(2), y1: +p.y.toFixed(2), x2: +q.x.toFixed(2), y2: +q.y.toFixed(2), major });
    }
    return out;
  }

  get labels(): { x: number; y: number; text: string; anchor: string }[] {
    const out = [];
    const r = this.R + this.BAND / 2 + 13;
    for (let v = this.min; v <= this.max + 1e-9; v += this.majorStep) {
      const f = this.frac(v);
      const p = this.point(f, r);
      out.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), text: this.tickLabel(v),
                 anchor: f < 0.3 ? 'end' : f > 0.7 ? 'start' : 'middle' });
    }
    return out;
  }

  /** Needle drawn pointing straight up; -90° is the minimum, +90° the maximum. */
  get needleDeg(): number {
    return this.value === null ? -90 : this.frac(this.value) * 180 - 90;
  }
  get needlePoints(): string {
    const tip = this.R - this.BAND / 2 - 10, base = 7.5, tail = 14;
    const { CX: x, CY: y } = this;
    return `${x - base},${y} ${x},${y - tip} ${x + base},${y} ${x},${y + tail}`;
  }

  get display(): string { return this.valueText(this.value); }

  /* The scale — band pieces, ticks, labels — depends only on the scale
     inputs. Built once per scale change, not on every reading: a live
     socket moves the value several times a second, and rebuilding these
     arrays would recreate some fifty SVG nodes each time. */
  bandPieces: { from: number; to: number; color: string | null }[] = [];
  tickMarks: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  scaleLabels: { x: number; y: number; text: string; anchor: string }[] = [];

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['min'] || ch['max'] || ch['zones'] || ch['majorStep'] || ch['minorPerMajor'] || ch['tickLabel'] || !this.tickMarks.length) {
      this.bandPieces  = this.pieces;
      this.tickMarks   = this.ticks;
      this.scaleLabels = this.labels;
    }
  }
}
