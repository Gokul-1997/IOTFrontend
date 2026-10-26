/*
 * The figures on a horizontal bar chart, read the same way on every dashboard
 * (26 Oct 2026, the user on Energy: one machine's big bar made the others
 * tiny — their figures did not fit, and a tiny bar was too thin to hover;
 * "a very small one: show its figure on hover only").
 *
 * A figure stays inside its bar, in white, when the bar is long enough to hold
 * it; a bar too short for it shows none. A hover anywhere along a row — not
 * only on the bar — shades the row and shows that row's tooltip.
 *
 * Spread the parts into the chart's options; plotOptions.bar is merged.
 */

/** A hover anywhere in a bar's row or column — not only on the bar, which may be a sliver — shows its tooltip. */
export const BAR_HOVER = { shared: false, intersect: false } as const;

/**
 * The row under the pointer, shaded light as ApexCharts shades a hovered
 * column's band — it draws none for a horizontal bar (26 Oct 2026, the user:
 * "the same light background on hover"). Goes in the chart's events.
 */
export const ROW_BAND = {
  mouseMove: (e: MouseEvent | TouchEvent, chart: any) => shadeRow(chart, e),
  mouseLeave: (_e: Event, chart: any) => shadeRow(chart, null)
};

function shadeRow(chart: any, e: MouseEvent | TouchEvent | null): void {
  const inner: SVGGElement | null = chart?.el?.querySelector('.apexcharts-inner.apexcharts-graphical') ?? null;
  if (!inner) return;
  let band = inner.querySelector<SVGRectElement>(':scope > rect.mexa-row-band');
  const w = chart.w, rows = Number(w?.globals?.labels?.length ?? w?.globals?.dataPoints);
  const width = Number(w?.layout?.gridWidth ?? w?.globals?.gridWidth), height = Number(w?.layout?.gridHeight ?? w?.globals?.gridHeight);
  const at = e && ('touches' in e ? e.touches[0] : e);
  const ctm = inner.getScreenCTM();
  let row = -1;
  if (at && ctm && rows > 0 && width > 0 && height > 0) {
    const local = new DOMPoint(at.clientX, at.clientY).matrixTransform(ctm.inverse());
    if (local.x >= 0 && local.x <= width && local.y >= 0 && local.y < height) row = Math.floor(local.y / (height / rows));
  }
  if (row < 0) { band?.setAttribute('visibility', 'hidden'); return; }
  if (!band) {
    band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    band.setAttribute('class', 'mexa-row-band');
    band.setAttribute('fill', 'rgba(148, 163, 184, .18)');
    band.setAttribute('pointer-events', 'none');
    inner.insertBefore(band, inner.firstChild);          // behind the bars and their figures
  }
  const h = height / rows;
  band.setAttribute('x', '0'); band.setAttribute('width', String(width));
  band.setAttribute('y', String(row * h)); band.setAttribute('height', String(h));
  band.setAttribute('visibility', 'visible');
}

/** How wide a 12px bold figure draws, measured in the app's font where the browser can. */
let measure: OffscreenCanvasRenderingContext2D | null | undefined;
export function figureWidth(text: string): number {
  if (measure === undefined) {
    try {
      measure = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
      if (measure) measure.font = '700 12px Ubuntu, system-ui, sans-serif';
    } catch { measure = null; }
  }
  return measure ? measure.measureText(text).width : text.length * 7;
}

/**
 * A column's figure, or nothing when the column is too short or too narrow to
 * hold it (22px tall by default: the figure and room round it); for stacked
 * columns, each piece. ApexCharts hands the formatter the axis top, the plot
 * height and the column width.
 */
export function columnFigure(format: (v: number) => string, minPx = 22, vertical = false) {
  return (v: number, opts?: any): string => {
    const n = Number(v), w = opts?.w, g = w?.globals;
    if (!Number.isFinite(n) || n <= 0) return '';
    const text = format(n);
    const top = Number(g?.maxYArr?.[opts?.seriesIndex] ?? g?.maxY), height = Number(w?.layout?.gridHeight ?? g?.gridHeight);
    const width = Number(g?.barWidth);
    // upright, a figure runs up the column: it needs the column's height for its length
    const along = vertical ? figureWidth(text) + 10 : minPx, across = vertical ? 16 : figureWidth(text) + 8;
    if (top > 0 && height > 0 && (n / top) * height < along) return '';
    if (width > 0 && width < across) return '';
    return text;
  };
}

/**
 * The figures on a column chart, as on the horizontal ones: in white in the
 * middle of a column that can hold it, none on one too short or too narrow —
 * its figure on hover (26 Oct 2026, the user: "the column charts too").
 * Upright (`vertical`) for columns side by side, too narrow to hold one across:
 * pass plotOptions.bar.dataLabels.orientation 'vertical' with it.
 */
export function columnFigures(format: (v: number) => string, series?: number[], { vertical = false }: { vertical?: boolean } = {}) {
  return {
    enabled: true, ...(series ? { enabledOnSeries: series } : {}), formatter: columnFigure(format, 22, vertical),
    // px, not rem: ApexCharts centres a figure in its column from the size's number —
    // by its baseline, which leaves the digits 4px low
    offsetY: 4, style: { fontSize: '12px', fontWeight: 700, colors: ['#fff'] }
  };
}

/** The axis end: a round number at or past `top`, in at most `maxTicks` steps (six) — whole steps for counts. */
export function barAxisMax(top: number, whole = false, maxTicks = 6): { max: number; ticks: number } {
  if (!(top > 0)) return { max: 1, ticks: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(top)));
  for (const step of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map(f => f * mag).filter(st => !whole || Number.isInteger(st))) {
    const ticks = Math.ceil(top / step - 1e-9);
    if (ticks <= maxTicks) return { max: +(step * ticks).toPrecision(12), ticks };
  }
  return { max: 10 * mag, ticks: 1 };
}

/**
 * A long category name on two lines rather than cut short (an alarm's text,
 * "PRESS SERVO ON FOR MORE THAN 5 SEC"); a longer one ends in "…". ApexCharts
 * draws an array as one line each.
 */
export function wrapLabel(text: string, width = 18, lines = 2): string | string[] {
  const words = String(text ?? '').trim().split(/\s+/);
  if (words.join(' ').length <= width) return words.join(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { out.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  // the last line takes the rest, cut short
  if (out.length > lines) out.splice(lines - 1, out.length, out.slice(lines - 1).join(' '));
  return out.map(l => (l.length > width ? l.slice(0, width - 1).trimEnd() + '…' : l));
}

/** How a bar chart is read: its bars' options, whole steps for counts, a fixed axis end, at most so many ticks. */
export interface BarFigureOptions { bar?: Record<string, unknown>; whole?: boolean; axisMax?: number; maxTicks?: number; }

/** Whether a figure of `text` fits inside a bar of `value` on an axis to `max` drawn `width` px wide (12px bold). */
export function figureFits(value: number, text: string, max: number, width: number): boolean {
  if (!(width > 0) || !(max > 0)) return true;
  return (value / max) * width >= figureWidth(text) + 12;
}

export function barFigures(values: unknown[], format: (v: number) => string,
                           { bar = {}, whole = false, axisMax, maxTicks = 6 }: BarFigureOptions = {}) {
  const top = axisMax ?? Math.max(0, ...values.map(Number).filter(Number.isFinite));
  const { max, ticks } = barAxisMax(top, whole, maxTicks);
  return {
    plotOptions: { bar: { ...bar, horizontal: true } },
    dataLabels: {
      enabled: true,
      formatter: (v: number, opts?: any) => {
        const text = format(Number(v));
        return figureFits(Number(v), text, max, opts?.w?.layout?.gridWidth ?? opts?.w?.globals?.gridWidth) ? text : '';
      },
      // px, not rem: ApexCharts centres a figure in its bar from the size's number
      style: { fontSize: '12px', fontWeight: 700, colors: ['#fff'] }
    },
    xaxis: { min: 0, max, tickAmount: ticks },
    tooltip: { ...BAR_HOVER, y: { formatter: (v: number) => format(Number(v)) } },
    events: ROW_BAND
  };
}
