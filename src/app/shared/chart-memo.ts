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

  private entries: Record<string, { value: any; generation: number; deps?: string }> = {};
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
   *
   * With `deps` — a string naming everything the value is built from, its
   * data included — a bump alone does not rebuild it: the same reference comes
   * back until `deps` changes. A dashboard polls every minute and most charts
   * on it have not changed since the last poll; rebuilding them anyway redrew
   * every SVG (about 300 layouts each refresh on the Maintenance screen).
   *
   * Put the chart's data in `deps` too, so new data rebuilds the options and
   * the chart is drawn afresh: when only `series` changes, ng-apexcharts calls
   * updateSeries, and ApexCharts 5.10 adds another tooltip element to the page
   * on every updateSeries — over a shift, tens of thousands of nodes.
   */
  memo<T>(key: string, build: () => T, deps?: string): T {
    const hit = this.entries[key];
    if (hit && (deps === undefined ? hit.generation === this.generation : hit.deps === deps)) return hit.value;

    const value = build();
    this.entries[key] = { value, generation: this.generation, deps };
    return value;
  }

  private kept: Record<string, { value: any; sig: string }> = {};

  /**
   * `next` — or the reference handed out for `key` last time, when the data is
   * the same, so a series that has not changed keeps the reference its chart
   * already drew from. Compared with what the data was when handed out: the
   * chart library writes into the arrays it is given.
   */
  keep<T>(key: string, next: T): T {
    const sig = JSON.stringify(next);
    const hit = this.kept[key];
    if (hit && hit.sig === sig) return hit.value;
    this.kept[key] = { value: next, sig };
    return next;
  }

  /** What `key` held when it was last kept — for a chart's `deps`. */
  sig(key: string): string {
    return this.kept[key]?.sig ?? '';
  }
}
