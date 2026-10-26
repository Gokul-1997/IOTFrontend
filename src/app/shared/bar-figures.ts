/*
 * The figures on a horizontal bar chart, read the same way on every dashboard
 * (26 Oct 2026, the user on Energy: one machine's big bar made the others
 * tiny — their figures did not fit, and a tiny bar was too thin to hover;
 * "a very small one: show its figure on hover only").
 *
 * A figure stays inside its bar, in white, when the bar is long enough to hold
 * it; a bar too short for it shows none. A hover anywhere along a row — not
 * only on the bar — shows that row's tooltip, beside the pointer.
 *
 * Spread the parts into the chart's options; plotOptions.bar is merged.
 */

/** A hover anywhere in a bar's row or column — not only on the bar, which may be a sliver — shows its tooltip. */
export const BAR_HOVER = { shared: false, intersect: false } as const;

/**
 * A column's figure, or nothing when the column is too short or too narrow to
 * hold it (16px tall by default); for stacked columns, each piece. ApexCharts
 * hands the formatter the axis top, the plot height and the column width.
 */
export function columnFigure(format: (v: number) => string, minPx = 16) {
  return (v: number, opts?: any): string => {
    const n = Number(v), w = opts?.w, g = w?.globals;
    if (!Number.isFinite(n) || n <= 0) return '';
    const text = format(n);
    const top = Number(g?.maxYArr?.[opts?.seriesIndex] ?? g?.maxY), height = Number(w?.layout?.gridHeight ?? g?.gridHeight);
    if (top > 0 && height > 0 && (n / top) * height < minPx) return '';
    const width = Number(g?.barWidth);
    if (width > 0 && width < text.length * 7 + 6) return '';
    return text;
  };
}

/**
 * The figures on a column chart, as on the horizontal ones: in white in the
 * middle of a column that can hold it, none on one too short or too narrow —
 * its figure on hover (26 Oct 2026, the user: "the column charts too").
 */
export function columnFigures(format: (v: number) => string, series?: number[]) {
  return {
    enabled: true, ...(series ? { enabledOnSeries: series } : {}), formatter: columnFigure(format),
    // px, not rem: ApexCharts centres a figure in its column from the size's number
    style: { fontSize: '12px', fontWeight: 700, colors: ['#fff'] }
  };
}

/** The axis end: a round number at or past `top`, in at most six steps — whole steps for counts. */
export function barAxisMax(top: number, whole = false): { max: number; ticks: number } {
  if (!(top > 0)) return { max: 1, ticks: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(top)));
  for (const step of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map(f => f * mag).filter(st => !whole || Number.isInteger(st))) {
    const ticks = Math.ceil(top / step - 1e-9);
    if (ticks <= 6) return { max: +(step * ticks).toPrecision(12), ticks };
  }
  return { max: 10 * mag, ticks: 1 };
}

/** Whether a figure of `text` fits inside a bar of `value` on an axis to `max` drawn `width` px wide (12px bold). */
export function figureFits(value: number, text: string, max: number, width: number): boolean {
  if (!(width > 0) || !(max > 0)) return true;
  return (value / max) * width >= text.length * 7 + 10;
}

export function barFigures(values: unknown[], format: (v: number) => string, bar: Record<string, unknown> = {}, whole = false,
                           axisMax?: number) {
  const top = axisMax ?? Math.max(0, ...values.map(Number).filter(Number.isFinite));
  const { max, ticks } = barAxisMax(top, whole);
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
    tooltip: { ...BAR_HOVER, y: { formatter: (v: number) => format(Number(v)) } }
  };
}
