import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, Directive, ElementRef, Input,
  OnDestroy, OnInit, Pipe, PipeTransform, ViewChild, inject
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { Subject, Subscription } from 'rxjs';
import { ColumnOption, TableState } from './table-state';

/*
 * The MEXA table's header: a sort and a filter in each column's header,
 * the way Ant Design's table has them (29 Oct 2026), in MEXA's own colours.
 *
 *   <table class="mexa-table" [mexaTable]="tbl">          (or <table mat-table … [mexaTable]="tbl">)
 *     <th mexaCol="machine_serial_no">Machine</th>
 *
 * - Sort: the whole header is the button. Ascending, descending, then the
 *   table's own order; aria-sort says which. The sorted column is tinted.
 * - Filter: the funnel at the header's end opens a small list of the
 *   column's values to tick, and the table follows at once (no Apply, as
 *   everywhere in MEXA). No search box inside the table (the user, 29 Oct
 *   2026). Clear empties it; Escape or a click outside closes it and focus
 *   goes back to the funnel.
 * The look is global (styles/_table.scss): the panel sits on <body>.
 */

let uid = 0;

/** The state of a table, for its header cells; marks the sorted column for the tint. */
@Directive({ selector: '[mexaTable]', standalone: true })
export class MexaTableDirective implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private current!: TableState;
  private sub?: Subscription;
  private readonly cells = new Set<MexaThComponent>();
  /** Any change to the state: the header cells re-draw. */
  readonly changed = new Subject<void>();

  @Input({ required: true })
  set mexaTable(state: TableState) {
    if (state === this.current) return;
    this.current = state;
    this.sub?.unsubscribe();
    this.sub = state.changed$.subscribe(() => { this.changed.next(); this.markSorted(); });
    this.changed.next();
    this.markSorted();
  }
  get state(): TableState { return this.current; }

  register(cell: MexaThComponent): void { this.cells.add(cell); this.markSorted(); }
  unregister(cell: MexaThComponent): void { this.cells.delete(cell); this.markSorted(); }

  /** data-sorted-col: the sorted column's place, for the tint on its cells (styles/_table.scss). */
  private markSorted(): void {
    const key = this.current?.sort?.key;
    const cell = key ? [...this.cells].find(c => c.mexaCol === key) : null;
    const index = cell ? (cell.el as HTMLTableCellElement).cellIndex : -1;
    if (index >= 0) this.el.setAttribute('data-sorted-col', String(index + 1));
    else this.el.removeAttribute('data-sorted-col');
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); this.changed.complete(); }
}

@Component({
  selector: 'th[mexaCol]',
  standalone: true,
  imports: [NgTemplateOutlet, OverlayModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mt-col',
    '[class.mt-sortable]': 'sortable',
    '[class.is-sorted]': '!!dir',
    '[class.is-filtered]': 'filtered',
    '[attr.aria-sort]': 'sortable ? ariaSort : null'
  },
  template: `
    <ng-template #title><ng-content></ng-content></ng-template>
    <div class="mt-th">
      @if (sortable) {
        <button type="button" class="mt-sort" (click)="toggleSort()" [attr.title]="sortHint">
          <span class="mt-title" #titleEl><ng-container [ngTemplateOutlet]="title"></ng-container></span>
          <span class="mt-carets" aria-hidden="true">
            <svg class="mt-caret" [class.on]="dir === 'asc'" viewBox="0 0 8 5"><path d="M4 0 8 5H0z"></path></svg>
            <svg class="mt-caret" [class.on]="dir === 'desc'" viewBox="0 0 8 5"><path d="M0 0h8L4 5z"></path></svg>
          </span>
        </button>
      } @else {
        <span class="mt-title mt-plain" #titleEl><ng-container [ngTemplateOutlet]="title"></ng-container></span>
      }
      @if (filterKind) {
        <button type="button" class="mt-filter" [class.on]="filtered" cdkOverlayOrigin #origin="cdkOverlayOrigin" #trigger
                (click)="toggleFilter()" aria-haspopup="dialog" [attr.aria-expanded]="open" [attr.aria-controls]="open ? id : null"
                [attr.aria-label]="'Filter ' + name + (filtered ? ' (on)' : '')" title="Filter">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h17l-6.6 8.1v5.6l-3.8 2.3v-7.9z" fill="currentColor"></path></svg>
        </button>
        <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open"
                     [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayPush]="true" [cdkConnectedOverlayViewportMargin]="8"
                     (overlayOutsideClick)="outside($event)" (overlayKeydown)="keydown($event)" (attach)="focusPanel()" (detach)="close(false)">
          <div class="mt-panel" role="dialog" [id]="id" [attr.aria-label]="'Filter ' + name" #panel>
            <ul class="mt-options" role="group" [attr.aria-label]="name">
              @for (o of choices; track o.value) {
                <li>
                  <label class="mt-option">
                    <input type="checkbox" [checked]="ticked.has(o.value)" (change)="tick(o.value, $any($event.target).checked)" />
                    <span class="mt-option-text">{{ o.label }}</span>
                    @if (o.count !== undefined) { <span class="mt-count">{{ o.count }}</span> }
                  </label>
                </li>
              } @empty {
                <li class="mt-none">Nothing to choose</li>
              }
            </ul>
            <div class="mt-foot">
              <button type="button" class="mt-clear" (click)="clear()" [disabled]="!filtered && !ticked.size">Clear</button>
              @if (ticked.size) { <span class="mt-picked">{{ ticked.size }} selected</span> }
            </div>
          </div>
        </ng-template>
      }
    </div>
  `
})
export class MexaThComponent implements OnInit, AfterViewInit, OnDestroy {
  /** The column's key in the table's state. */
  @Input({ required: true }) mexaCol!: string;

  @ViewChild('titleEl') private titleEl?: ElementRef<HTMLElement>;
  @ViewChild('trigger') private trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  private readonly table = inject(MexaTableDirective);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private sub?: Subscription;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly id = `mt-filter-${++uid}`;
  open = false;
  private named = '';
  /** The panel's own copy of the ticked values while it is open. */
  ticked = new Set<string>();

  readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 }
  ];

  private get state(): TableState { return this.table.state; }
  get sortable(): boolean { return !!this.state?.sortable(this.mexaCol); }
  get dir() { return this.state?.dirOf(this.mexaCol) ?? null; }
  get ariaSort() { return this.state?.ariaSort(this.mexaCol) ?? 'none'; }
  get filterKind() { return this.state?.filterKind(this.mexaCol) ?? null; }
  get filtered(): boolean { return !!this.state?.isFiltered(this.mexaCol); }
  /** The column's name, from its header text: "Filter Machine". */
  get name(): string {
    if (!this.named) this.named = (this.titleEl?.nativeElement.textContent || this.el.textContent || '').replace(/\s+/g, ' ').trim();
    return this.named || this.mexaCol;
  }
  get sortHint(): string { return this.dir === null ? 'Sort ascending' : this.dir === 'asc' ? 'Sort descending' : 'Clear the sort'; }

  get choices(): ColumnOption[] { return this.state?.options(this.mexaCol) ?? []; }

  ngOnInit(): void {
    this.sub = this.table.changed.subscribe(() => this.cdr.markForCheck());
    this.table.register(this);
  }

  ngAfterViewInit(): void {
    this.named = '';            // read again now the header text is in
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.cancel();             // the page is going: nothing more to ask for
    this.sub?.unsubscribe();
    this.table.unregister(this);
  }

  toggleSort(): void { this.state.toggleSort(this.mexaCol); }

  toggleFilter(): void { this.open ? this.close(true) : this.openPanel(); }

  private openPanel(): void {
    this.ticked = new Set(this.state.filters[this.mexaCol] || []);
    this.open = true;
    this.cdr.markForCheck();
  }

  close(refocus: boolean): void {
    if (!this.open) return;
    this.flush();
    this.open = false;
    this.cdr.markForCheck();
    if (refocus) this.trigger?.nativeElement.focus();
  }

  focusPanel(): void {
    // the first tick box
    setTimeout(() => this.panel?.nativeElement.querySelector<HTMLElement>('input')?.focus());
  }

  outside(e: MouseEvent): void {
    if (this.trigger?.nativeElement.contains(e.target as Node)) return;   // its own button toggles
    this.close(false);
  }

  keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
  }

  tick(value: string, on: boolean): void {
    on ? this.ticked.add(value) : this.ticked.delete(value);
    this.ticked = new Set(this.ticked);
    this.later(() => this.state.setFilter(this.mexaCol, [...this.ticked]));
  }

  clear(): void {
    this.cancel();
    this.ticked = new Set();
    this.state.clearFilter(this.mexaCol);
    this.cdr.markForCheck();
  }

  /** A server table asks the API once the ticking pauses; a client table follows at once. */
  private later(apply: () => void): void {
    this.cancel();
    if (this.state.mode === 'client') { apply(); return; }
    this.pending = apply;
    this.timer = setTimeout(() => this.flush(), 350);
  }
  private pending: (() => void) | null = null;

  private flush(): void {
    const apply = this.pending;
    this.cancel();
    apply?.();
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

/** rows | tableView:tbl:tbl.version — the rows filtered and sorted (a client table), as they are (a server one). */
@Pipe({ name: 'tableView', standalone: true })
export class TableViewPipe implements PipeTransform {
  transform<T>(rows: readonly T[] | null | undefined, state: TableState<T>, _version?: number): T[] {
    return state.view(rows);
  }
}

/** Everything a page imports for the MEXA table. */
export const MEXA_TABLE = [MexaTableDirective, MexaThComponent, TableViewPipe] as const;
