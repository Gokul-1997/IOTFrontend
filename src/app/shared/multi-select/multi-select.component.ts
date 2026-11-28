import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild, forwardRef, inject
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CdkConnectedOverlay, ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { searchKey } from '../search-select.directive';

/*
 * A form field that takes several values from one list (28 Nov 2026, the
 * user: "in component entry I need to select multiple machines").
 *
 *   <label class="ui-label" for="compMachines">Machines</label>
 *   <app-multi-select inputId="compMachines" formControlName="machine_ids"
 *                     noun="machine" placeholder="Select machines" [options]="machineOptions" />
 *
 * The field looks as every select (.ui-input) and shows what is picked as
 * chips. It opens a list with the machine dropdown's search box (search
 * ignores case, spaces and dashes: "vmc2" finds "VMC - 2 - F") over the
 * table filter's tick list, with Select all / Clear and the count. Ticks
 * apply at once — no Apply. The value is the picked options' values, in the
 * list's order.
 *
 * Keyboard: ↓, ↑ or a letter on the field opens it (the letter searched);
 * ↓ ↑ move between the search box and the ticks, Space ticks, Enter in the
 * search box ticks the first match; Esc closes back to the field; Tab past
 * either end closes it and moves on. On a touch screen the search box is not
 * focused at once, so the keyboard does not cover the list.
 *
 * The list is an overlay on <body> (never cut off by a dialog); its look is
 * global, styles/_multi-select.scss. Keys inside it are its own: the dialog
 * it opens from does not close on its Esc (core/ui/dialog-a11y).
 */
export interface MultiOption { value: string | number; label: string; }
interface Option extends MultiOption { key: string; find: string; }

let uid = 0;
const keyOf = (value: unknown): string => String(value);

@Component({
  selector: 'app-multi-select',
  standalone: true,
  imports: [OverlayModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MultiSelectComponent), multi: true }],
  host: { class: 'ms' },
  template: `
    <button #trigger type="button" class="ui-input ms-trigger" [id]="inputId"
            cdkOverlayOrigin #origin="cdkOverlayOrigin"
            [disabled]="disabled" [class.is-invalid]="invalid" [class.is-open]="open"
            aria-haspopup="dialog" [attr.aria-expanded]="open" [attr.aria-controls]="open ? panelId : null"
            [attr.aria-required]="required || null" [attr.aria-invalid]="invalid || null"
            [attr.aria-describedby]="describedByIds"
            (click)="toggle()" (keydown)="fieldKey($event)" (blur)="fieldBlur()">
      @if (picked.length) {
        <!-- two whole names when the field has room, else one; the rest as a count (the summary below names them all) -->
        <span class="ms-value" aria-hidden="true">
          <span class="ms-chips ms-wide">
            @for (o of chips; track o.key) { <span class="ms-chip">{{ o.label }}</span> }
            @if (picked.length > chips.length) { <span class="ms-chip ms-more">+{{ picked.length - chips.length }}</span> }
          </span>
          <span class="ms-chips ms-narrow">
            <span class="ms-chip">{{ picked[0].label }}</span>
            @if (picked.length > 1) { <span class="ms-chip ms-more">+{{ picked.length - 1 }}</span> }
          </span>
        </span>
      } @else {
        <span class="ms-placeholder">{{ placeholder }}</span>
      }
      <svg class="ms-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m19.5 8.25-7.5 7.5-7.5-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </button>
    <span class="sr-only" [id]="summaryId">{{ summary }}</span>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open"
                 [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayPush]="true" [cdkConnectedOverlayViewportMargin]="8"
                 [cdkConnectedOverlayMinWidth]="width"
                 (overlayOutsideClick)="outside($event)" (attach)="attached()" (detach)="close(false)">
      <div #panel class="mt-panel ms-panel" role="dialog" tabindex="-1" [id]="panelId" [attr.aria-label]="'Choose ' + plural"
           (keydown)="panelKey($event)">
        <div class="ss-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
          <input #search type="text" autocomplete="off" spellcheck="false" [value]="query" (input)="filter($any($event.target).value)"
                 [attr.aria-label]="'Search ' + plural" [placeholder]="'Search ' + plural + '…'" [attr.aria-controls]="listId" />
        </div>
        <div class="ms-bar">
          <button type="button" class="mt-clear" (click)="pickShown()" [disabled]="!canPickShown">{{ query ? 'Select shown' : 'Select all' }}</button>
          <button type="button" class="mt-clear" (click)="clear()" [disabled]="!picked.length">Clear</button>
          <span class="mt-picked" aria-live="polite">{{ picked.length }} of {{ all.length }} selected</span>
        </div>
        <ul class="mt-options ms-options" role="group" [id]="listId" [attr.aria-label]="plural">
          @for (o of shown; track o.key) {
            <li>
              <label class="mt-option">
                <input type="checkbox" [checked]="chosen.has(o.key)" (change)="set(o, $any($event.target).checked)" />
                <span class="mt-option-text">{{ o.label }}</span>
              </label>
            </li>
          } @empty {
            <li class="mt-none">{{ all.length ? 'No ' + noun + ' matches “' + query + '”' : 'No ' + plural + ' to choose from' }}</li>
          }
        </ul>
      </div>
    </ng-template>
  `
})
export class MultiSelectComponent implements ControlValueAccessor, OnDestroy {
  /** The choices, in the order they are listed (and the value is given). */
  @Input() set options(list: readonly MultiOption[] | null | undefined) {
    this.all = (list || []).map(o => ({ ...o, key: keyOf(o.value), find: searchKey(o.label) }));
    this.refilter();
    this.recount();
  }
  /** The field's id, for its <label for>. */
  @Input() inputId = `ms-${++uid}`;
  @Input() placeholder = 'Select…';
  /** What one choice is called, for the search box and the messages: "machine". */
  @Input() noun = 'item';
  /** …and more than one; "machines" when left out. */
  @Input() nouns = '';
  @Input() invalid = false;
  @Input() required = false;
  /** The field's hint or error, read after its name. */
  @Input() describedBy: string | null = null;

  @ViewChild('trigger', { static: true }) private trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;
  @ViewChild('search') private search?: ElementRef<HTMLInputElement>;
  @ViewChild(CdkConnectedOverlay) private overlay?: CdkConnectedOverlay;

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);

  all: Option[] = [];
  shown: Option[] = [];
  picked: Option[] = [];
  chips: Option[] = [];
  chosen = new Set<string>();
  query = '';
  open = false;
  disabled = false;
  width = 0;

  readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
  ];

  private onChange: (value: (string | number)[]) => void = () => {};
  private onTouched: () => void = () => {};
  private stopFollowing: (() => void) | null = null;

  get plural(): string { return this.nouns || `${this.noun}s`; }
  get panelId(): string { return `${this.inputId}-panel`; }
  get listId(): string { return `${this.inputId}-list`; }
  get summaryId(): string { return `${this.inputId}-picked`; }
  get describedByIds(): string { return [this.summaryId, this.describedBy].filter(Boolean).join(' '); }
  get canPickShown(): boolean { return this.shown.some(o => !this.chosen.has(o.key)); }

  /** What a screen reader hears after the field's name. */
  get summary(): string {
    const n = this.picked.length;
    if (!n) return `No ${this.plural} selected`;
    const names = this.picked.slice(0, 5).map(o => o.label).join(', ');
    return n > 5 ? `${n} ${this.plural} selected: ${names} and ${n - 5} more` : `Selected: ${names}`;
  }

  // ── the form's side ──
  writeValue(value: unknown): void {
    this.chosen = new Set((Array.isArray(value) ? value : []).map(keyOf));
    this.recount();
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: (string | number)[]) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    if (disabled) this.close(false);
    this.cdr.markForCheck();
  }

  // ── opening and closing ──
  toggle(): void { this.open ? this.close(true) : this.show(); }

  fieldKey(e: KeyboardEvent): void {
    if (this.disabled || this.open || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.show(); }
    else if (e.key.length === 1 && e.key !== ' ' && !e.altKey) { e.preventDefault(); this.show(e.key); }
  }

  /** Leaving the field closed counts as having been there; opening it does not. */
  fieldBlur(): void { if (!this.open) this.onTouched(); }

  private show(typed = ''): void {
    if (this.disabled) return;
    this.width = this.trigger.nativeElement.getBoundingClientRect().width;
    this.query = typed;
    this.refilter();
    this.open = true;
    this.cdr.markForCheck();
  }

  close(refocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.stopFollowing?.();
    this.stopFollowing = null;
    this.onTouched();
    this.cdr.markForCheck();
    if (refocus) this.trigger.nativeElement.focus();
  }

  attached(): void {
    setTimeout(() => {
      if (!this.open) return;
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      const box = this.search?.nativeElement;
      (touch ? this.panel?.nativeElement : box)?.focus();
      if (!touch && box && this.query) box.setSelectionRange(this.query.length, this.query.length);
    });
    // a dialog that scrolls under the list keeps it beside the field
    this.zone.runOutsideAngular(() => {
      const follow = (e: Event) => {
        if (!this.panel?.nativeElement.contains(e.target as Node)) this.overlay?.overlayRef?.updatePosition();
      };
      document.addEventListener('scroll', follow, true);
      window.addEventListener('resize', follow);
      this.stopFollowing = () => { document.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
    });
  }

  outside(e: MouseEvent): void {
    if (this.trigger.nativeElement.contains(e.target as Node)) return;   // the field toggles it itself
    this.close(false);
  }

  panelKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const box = this.search?.nativeElement;
    const ticks = Array.from(this.panel?.nativeElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();                    // the list closes, not the dialog behind it
      this.close(true);
    } else if (e.key === 'Tab') {
      const stops = Array.from(this.panel?.nativeElement.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? []);
      const at = stops.indexOf(target);
      // past either end: back on the field, and the Tab moves on from there
      if ((!e.shiftKey && at === stops.length - 1) || (e.shiftKey && at <= 0)) this.close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = target === box ? -1 : ticks.indexOf(target as HTMLInputElement);
      const next = e.key === 'ArrowDown' ? Math.min(at + 1, ticks.length - 1) : at - 1;
      (next < 0 ? box : ticks[next])?.focus();
    } else if ((e.key === 'Home' || e.key === 'End') && target !== box && ticks.length) {
      e.preventDefault();
      ticks[e.key === 'Home' ? 0 : ticks.length - 1].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (target === box) {
        const first = this.shown[0];
        if (this.query && first) { this.set(first, !this.chosen.has(first.key)); box.select(); }
      } else if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        target.click();
      }
    }
  }

  // ── picking ──
  filter(text: string): void {
    this.query = text;
    this.refilter();
    this.cdr.markForCheck();
  }

  set(o: Option, on: boolean): void {
    on ? this.chosen.add(o.key) : this.chosen.delete(o.key);
    this.changed();
  }

  /** Every option shown: all of them, or the ones the search found. */
  pickShown(): void {
    for (const o of this.shown) this.chosen.add(o.key);
    this.changed();
  }

  clear(): void {
    this.chosen.clear();
    this.changed();
  }

  ngOnDestroy(): void { this.stopFollowing?.(); }

  private changed(): void {
    this.recount();
    this.onChange(this.picked.map(o => o.value));
    this.cdr.markForCheck();
  }

  private refilter(): void {
    const q = searchKey(this.query);
    this.shown = q ? this.all.filter(o => o.find.includes(q)) : this.all;
  }

  private recount(): void {
    this.picked = this.all.filter(o => this.chosen.has(o.key));
    this.chips = this.picked.slice(0, 2);
  }
}
