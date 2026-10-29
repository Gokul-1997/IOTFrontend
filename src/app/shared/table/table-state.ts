import { Observable, Subject } from 'rxjs';

/*
 * One table's header state: the sort, and a filter per column — the MEXA
 * table (29 Oct 2026, the user: "this table design and features — header
 * filter and sorting — on all pages", pointing at Ant Design's table; then
 * "no search inside the table": a filter is a list of values to tick).
 *
 *   readonly tbl = new TableState<Row>([
 *     { key: 'machine_serial_no', filter: 'list' },
 *     { key: 'status', filter: 'list', label: enumLabel },
 *     { key: 'title' },
 *     { key: 'started_at', type: 'date' }
 *   ]);
 *
 *   <table class="mexa-table" [mexaTable]="tbl">
 *     <th mexaCol="machine_serial_no">Machine</th> …
 *     <tr *ngFor="let r of rows | tableView:tbl:tbl.version"> …
 *
 * Client tables (every row is loaded) sort and filter here. Server tables
 * (paged by the API) set mode 'server': nothing is sorted here, the page
 * asks the API again with params() — ?sort=&dir=&f_<col>=a,b, read by the
 * backend's lib/table-query.js.
 *
 * A header click sorts ascending, then descending, then back to the
 * table's own order, as Ant's does. Rows with no value stay last either
 * way. Text compares the way people read it: "VMC - 2" before "VMC - 10".
 */
export type SortDir = 'asc' | 'desc';
export interface TableSort { key: string; dir: SortDir; }
export interface ColumnOption { value: string; label: string; count?: number; }

export interface TableColumn<T = any> {
  key: string;
  /** What sorting and filtering read; row[key] when not given. */
  value?: (row: T) => unknown;
  /** How values compare; worked out from the values when not given. */
  type?: 'text' | 'number' | 'date';
  /** Sortable (the default), or not. */
  sort?: boolean;
  /** A list of values to tick. */
  filter?: 'list';
  /** The list's choices when known (a server table, a fixed set of statuses); else read from the rows. */
  options?: ColumnOption[] | (() => ColumnOption[]);
  /** How a value reads in the list (enumLabel for codes). */
  label?: (value: string) => string;
}

/** A stored code as words, for a filter's choices: IN_PROGRESS → "In progress" (as the enumLabel pipe). */
export function words(code: unknown): string {
  const w = String(code ?? '').replace(/_+/g, ' ').trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Fixed choices from codes: options(['OPEN', 'CLOSED']) → Open, Closed. */
export function codes(list: readonly string[], label: (v: string) => string = words): ColumnOption[] {
  return list.map(value => ({ value, label: label(value) }));
}

/** A value with nothing in it, as a filter choice (and as the API reads it). */
export const BLANK = '__blank__';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export class TableState<T = any> {
  readonly mode: 'client' | 'server';
  sort: TableSort | null;
  /** Ticked values per column. */
  filters: Record<string, string[]> = {};
  /** Bumped on every change: what the tableView pipe and the header cells watch. */
  version = 0;

  private readonly initialSort: TableSort | null;
  private readonly byKey = new Map<string, TableColumn<T>>();
  private readonly changes = new Subject<void>();
  readonly changed$: Observable<void> = this.changes.asObservable();
  private memo: { rows: readonly T[]; version: number; out: T[] } | null = null;
  private inferred = new Map<string, 'text' | 'number' | 'date'>();
  /** The rows last shown, so a list filter can offer their values. */
  private seen: readonly T[] = [];

  constructor(readonly columns: TableColumn<T>[], opts: { mode?: 'client' | 'server'; sort?: TableSort | null; onChange?: () => void } = {}) {
    this.mode = opts.mode || 'client';
    this.sort = opts.sort || null;
    this.initialSort = this.sort;
    for (const c of columns) this.byKey.set(c.key, c);
    if (opts.onChange) this.changed$.subscribe(opts.onChange);
  }

  column(key: string): TableColumn<T> | undefined { return this.byKey.get(key); }

  sortable(key: string): boolean {
    const c = this.byKey.get(key);
    return !!c && c.sort !== false;
  }

  filterKind(key: string): 'list' | null { return this.byKey.get(key)?.filter || null; }

  /* ── sorting ── */

  /** A header click: ascending, then descending, then the table's own order. */
  toggleSort(key: string): void {
    if (!this.sortable(key)) return;
    const s = this.sort;
    if (!s || s.key !== key) this.sort = { key, dir: 'asc' };
    else if (s.dir === 'asc') this.sort = { key, dir: 'desc' };
    else this.sort = null;
    this.bump();
  }

  /** Set the sort from code (a tile that means "longest first"); `emit` false changes it quietly. */
  setSort(sort: TableSort | null, emit = true): void {
    this.sort = sort;
    emit ? this.bump() : this.version++;
  }

  dirOf(key: string): SortDir | null { return this.sort?.key === key ? this.sort.dir : null; }

  ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    const d = this.dirOf(key);
    return d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none';
  }

  /* ── filters ── */

  setFilter(key: string, values: string[]): void {
    const next = [...new Set(values)];
    if (next.length) this.filters = { ...this.filters, [key]: next };
    else { const { [key]: _, ...rest } = this.filters; this.filters = rest; }
    this.bump();
  }

  clearFilter(key: string): void {
    if (!(key in this.filters)) return;
    const { [key]: _, ...filters } = this.filters;
    this.filters = filters;
    this.bump();
  }

  /** Every filter off and the table's own sort back. */
  reset(): void {
    this.filters = {};
    this.sort = this.initialSort;
    this.bump();
  }

  isFiltered(key: string): boolean { return !!this.filters[key]?.length; }
  get anyFilter(): boolean { return Object.keys(this.filters).length > 0; }

  /* ── client tables ── */

  /** The rows filtered and sorted. The same array back while nothing changed. */
  view(rows: readonly T[] | null | undefined): T[] {
    const list = rows || [];
    this.seen = list;
    if (this.memo && this.memo.rows === list && this.memo.version === this.version) return this.memo.out;
    this.inferred.clear();
    let out = this.mode === 'server' ? [...list] : list.filter(r => this.passes(r));
    if (this.mode === 'client' && this.sort) out = this.sorted(out, this.sort);
    this.memo = { rows: list, version: this.version, out };
    return out;
  }

  /** A list filter's choices: given, or the values in the rows, with how many rows have each. */
  options(key: string): ColumnOption[] {
    const c = this.byKey.get(key);
    if (!c) return [];
    const label = (v: string) => v === BLANK ? '(Blank)' : c.label ? c.label(v) : v;
    if (c.options) {
      const given = typeof c.options === 'function' ? c.options() : c.options;
      return given.map(o => ({ ...o, label: o.label ?? label(o.value) }));
    }
    const counts = new Map<string, number>();
    for (const r of this.seen) {
      const k = this.keyOf(this.read(c, r));
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    // a value ticked earlier stays on the list, so it can be unticked
    for (const v of this.filters[key] || []) if (!counts.has(v)) counts.set(v, 0);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: label(value), count }))
      .sort((a, b) => a.value === BLANK ? 1 : b.value === BLANK ? -1 : collator.compare(a.label, b.label));
  }

  /* ── server tables ── */

  /** The request's sort and filters: ?sort=&dir=&f_<col>=a,b (lib/table-query.js). */
  params(): Record<string, string> {
    const p: Record<string, string> = {};
    if (this.sort) { p['sort'] = this.sort.key; p['dir'] = this.sort.dir; }
    for (const [k, v] of Object.entries(this.filters)) if (v.length) p[`f_${k}`] = v.join(',');
    return p;
  }

  /* ── inside ── */

  private bump(): void {
    this.version++;
    this.changes.next();
  }

  private read(c: TableColumn<T>, row: T): unknown {
    return c.value ? c.value(row) : (row as any)?.[c.key];
  }

  private keyOf(v: unknown): string {
    if (isEmpty(v)) return BLANK;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v).trim();
  }

  private passes(row: T): boolean {
    for (const [key, values] of Object.entries(this.filters)) {
      const c = this.byKey.get(key);
      if (!c || !values.length) continue;
      if (!values.includes(this.keyOf(this.read(c, row)))) return false;
    }
    return true;
  }

  private typeOf(c: TableColumn<T>, rows: readonly T[]): 'text' | 'number' | 'date' {
    if (c.type) return c.type;
    const known = this.inferred.get(c.key);
    if (known) return known;
    let type: 'text' | 'number' | 'date' = 'text';
    for (const r of rows) {
      const v = this.read(c, r);
      if (isEmpty(v)) continue;
      type = typeof v === 'number' ? 'number'
        : v instanceof Date ? 'date'
        : typeof v === 'string' && NUMERIC.test(v.trim()) ? 'number'
        : typeof v === 'string' && ISO_DATE.test(v.trim()) ? 'date'
        : 'text';
      break;
    }
    this.inferred.set(c.key, type);
    return type;
  }

  private sorted(rows: T[], sort: TableSort): T[] {
    const c = this.byKey.get(sort.key);
    if (!c) return rows;
    const type = this.typeOf(c, rows);
    const sign = sort.dir === 'asc' ? 1 : -1;
    const keyed = rows.map(r => {
      const v = this.read(c, r);
      let k: number | string | null;
      if (isEmpty(v)) k = null;
      else if (type === 'number') { const n = Number(v); k = Number.isFinite(n) ? n : null; }
      else if (type === 'date') { const t = v instanceof Date ? v.getTime() : Date.parse(String(v)); k = Number.isFinite(t) ? t : null; }
      else k = String(v);
      return { r, k };
    });
    // a stable sort; rows with no value last, whichever way
    keyed.sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === null ? (b.k === null ? 0 : 1) : -1;
      const d = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : collator.compare(String(a.k), String(b.k));
      return d * sign;
    });
    return keyed.map(x => x.r);
  }
}
