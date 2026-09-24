import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface HourlyReading { hour: string; produced: number | null; }

@Component({
  selector: 'app-production-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production-chart.component.html',
  styleUrl: './production-chart.component.scss'
})
export class ProductionChartComponent implements OnChanges {
  @Input() rows: HourlyReading[] = [];
  readonly Math = Math;
  mode: 'bar' | 'line' = 'bar';
  selected: number | null = null;
  max = 10;
  points: { x: number; y: number; hour: string; produced: number | null; label: boolean }[] = [];
  ticks: number[] = [];
  lines: string[] = [];
  barWidth = 32;
  total = 0;
  peak = 0;

  ngOnChanges(): void {
    const numbers = this.rows.map(row => row.produced).filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    this.total = numbers.reduce((sum, value) => sum + value, 0);
    this.peak = Math.max(0, ...numbers);
    // Use four readable ticks, including for all-zero hours.
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, this.peak / 4)));
    const step = Math.ceil(Math.max(1, this.peak / 4) / magnitude) * magnitude;
    this.max = step * 4;
    this.ticks = [0, step, step * 2, step * 3, this.max];
    const spacing = 640 / Math.max(1, this.rows.length);
    this.barWidth = Math.min(44, spacing * .55);
    this.points = this.rows.map((row, index) => ({
      ...row,
      x: 52 + spacing * (index + .5),
      y: 198 - (row.produced ?? 0) / this.max * 166,
      label: index % Math.max(1, Math.ceil(this.rows.length / 8)) === 0 || index === this.rows.length - 1
    }));
    // A missing hour breaks the line. It must never be drawn as a measured zero.
    this.lines = [];
    let segment: string[] = [];
    for (const point of this.points) {
      if (point.produced === null) {
        if (segment.length) this.lines.push(segment.join(' '));
        segment = [];
      } else segment.push(`${point.x},${point.y}`);
    }
    if (segment.length) this.lines.push(segment.join(' '));
    if (this.selected !== null && this.selected >= this.rows.length) this.selected = null;
  }

  select(index: number): void { this.selected = index; }
  move(event: KeyboardEvent, index: number): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = Math.max(0, Math.min(this.points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
    const parent = (event.currentTarget as SVGElement).parentElement;
    (parent?.querySelectorAll<SVGElement>('.hour-point')[next] as SVGElement & { focus(): void })?.focus();
    this.select(next);
  }
}
