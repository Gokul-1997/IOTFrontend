/**
 * Stable chart-option objects.
 *
 * Every dashboard binds its ApexCharts options through getters. A getter
 * builds a fresh object literal on each call, and the template calls it on
 * each change-detection pass — so ng-apexcharts, which compares its @Inputs
 * by reference, sees "new" options every time and tears the SVG down and
 * rebuilds it. The visible cost is a chart that re-animates whenever anything
 * on the page is clicked: the header listens on document:click, so *any*
 * click anywhere schedules a pass.
 *
 * The data itself was never the problem — series and categories are already
 * cached in fields assigned inside apply(). This gives the options the same
 * treatment without moving them out of the getters: the same object is handed
 * back until bump() says the underlying data changed.
 */
export class ChartMemo {

  private entries: Record<string, { value: any; generation: number }> = {};
  private generation = 0;

  /** Called when new data arrives; every memoised option is rebuilt once, lazily. */
  bump(): void {
    this.generation++;
  }

  /**
   * The same reference for `key` until the next bump().
   *
   * `build` is only ever called when the entry is missing or stale, so an
   * option object for a chart the template never renders is never built.
   */
  memo<T>(key: string, build: () => T): T {
    const hit = this.entries[key];
    if (hit && hit.generation === this.generation) return hit.value;

    const value = build();
    this.entries[key] = { value, generation: this.generation };
    return value;
  }
}
