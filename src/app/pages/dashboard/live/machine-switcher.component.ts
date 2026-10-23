import { Component, ChangeDetectionStrategy, ChangeDetectorRef, ElementRef, Input, OnDestroy, OnInit, Renderer2, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DashboardService } from '../dashboard.service';

/** A machine as the Live Dashboard lists it. */
export interface MachineChoice { machine_id: number; machine_serial_no: string; status: string; alarm: boolean; }

const WORD: Record<string, string> = { RUNNING: 'Running', IDLE: 'Idle', ALARM: 'Alarm', OFFLINE: 'Offline' };
const STATES = new Set(Object.keys(WORD));
/** What a search compares: "VMC - 12 - F" is found by "vmc12f", "12 f" or "VMC-12". */
export const plainName = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** The list is read again when it opens, unless it arrived this recently (ms). */
const FRESH_MS = 15_000;
let nextUid = 0;

/*
 * The machine's name at the top of its page, as a dropdown of the company's
 * machines with a search box (23 Oct 2026, the user: to see the next machine
 * they went back to the Live Dashboard and clicked it each time). A click —
 * or Enter — opens that machine here.
 *
 * The machines are in the Live Dashboard's order, so the one below this one
 * is the next card there, each with its status now. Keyboard: the name opens
 * the list on the search box; ↑ / ↓ move, Enter opens, Esc closes. With no
 * other machine to go to (or an API without the list) the name is plain
 * text, as it was.
 *
 * The list hangs from the page's title bar, which is position: relative.
 */
@Component({
  selector: 'app-machine-switcher',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { min-width: 0; }
    /* the name sits where the plain name sat; its hover and focus shape is drawn around it, outside the layout */
    .ms-trigger { position: relative; isolation: isolate; display: inline-flex; align-items: center; gap: .1rem; max-width: 100%;
                  margin: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .ms-trigger::before { content: ''; position: absolute; inset: -.15rem -.4rem; z-index: -1; border-radius: 8px; }
    .ms-trigger:hover::before { background: rgba(255, 255, 255, .14); }
    .ms-trigger:focus-visible { outline: none; }
    .ms-trigger:focus-visible::before { box-shadow: 0 0 0 2px #fff; }
    .ms-name { min-width: 0; overflow-wrap: anywhere; }
    .ms-chevron { width: 22px; font-size: 22px; transition: transform .15s; }
    .ms-trigger[aria-expanded="true"] .ms-chevron { transform: rotate(180deg); }
    .ms-panel { position: absolute; top: calc(100% + 6px); left: .5rem; z-index: 40; display: grid; gap: .35rem;
                width: min(22rem, calc(100% - 1rem)); padding: .35rem; border-radius: 12px; font-size: .9rem; font-weight: 400;
                background: var(--mexa-card, #fff); color: var(--mexa-ink, #1f2430);
                box-shadow: 0 16px 40px rgba(18, 14, 64, .2), 0 0 0 1px rgba(18, 14, 64, .06); }
    .mexa-searchbox, .mexa-search { width: 100%; min-width: 0; }
    .ms-list { display: grid; gap: 2px; max-height: min(20rem, 55vh); overflow-y: auto; overscroll-behavior: contain;
               margin: 0; padding: 0; list-style: none; }
    .ms-item { display: flex; align-items: center; gap: .65rem; min-height: 40px; padding: .45rem .7rem; border-radius: 8px;
               font-weight: 500; cursor: pointer; }
    .ms-item:hover, .ms-item.is-active { background: #eef0fb; }
    .ms-item.is-active { box-shadow: inset 0 0 0 2px #2b3990; }
    .ms-item.is-current { background: #863567; color: #fff; }
    .ms-item.is-current.is-active { box-shadow: inset 0 0 0 2px #fff; }
    .ms-item-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .ms-item-state { font-size: .78rem; font-weight: 400; color: var(--mexa-ink-3, #5d6679); }
    .ms-item.is-current .ms-item-state { color: #fff; }
    .ms-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #94a3b8; }
    .ms-dot[data-state="RUNNING"] { background: #0cad5d; }
    .ms-dot[data-state="IDLE"] { background: #eab308; }
    .ms-dot[data-state="ALARM"] { background: #fb3748; }
    .ms-item.is-current .ms-dot { box-shadow: 0 0 0 2px #fff; }
    .ms-note { margin: 0; padding: .5rem .7rem; color: var(--mexa-ink-3, #5d6679); }
    .ms-retry { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: #2b3990; text-decoration: underline; cursor: pointer; }
    :host-context(.dark) .ms-panel { box-shadow: 0 16px 40px rgba(0, 0, 0, .5), 0 0 0 1px rgba(255, 255, 255, .08); }
    :host-context(.dark) .ms-item:hover, :host-context(.dark) .ms-item.is-active { background: #162d4e; }
    :host-context(.dark) .ms-item.is-active { box-shadow: inset 0 0 0 2px #9fb3ff; }
    :host-context(.dark) .ms-item.is-current { background: #863567; }
    :host-context(.dark) .ms-retry { color: #9fb3ff; }
    @media (prefers-reduced-motion: reduce) { .ms-chevron { transition: none; } }
  `],
  template: `
  <h1 class="text-xl font-medium text-white">
    <button *ngIf="switchable; else plain" #trigger type="button" class="ms-trigger" title="Choose another machine"
            aria-haspopup="listbox" [attr.aria-expanded]="open" [attr.aria-controls]="open ? uid + '-list' : null"
            (click)="toggle()" (keydown)="onTriggerKey($event)">
      <span class="ms-name">{{ label }}</span>
      <span class="material-icons ms-chevron" aria-hidden="true">expand_more</span>
    </button>
    <ng-template #plain>{{ label }}</ng-template>
  </h1>

  <div *ngIf="open" class="ms-panel" (focusout)="onFocusOut($event)" (keydown.escape)="onEscape($event)">
    <div class="mexa-searchbox">
      <span class="material-icons" aria-hidden="true">search</span>
      <input #search type="search" class="mexa-search" placeholder="Search machine" autocomplete="off" spellcheck="false"
             role="combobox" aria-label="Search machines" aria-autocomplete="list" aria-expanded="true"
             [attr.aria-controls]="uid + '-list'" [attr.aria-activedescendant]="active >= 0 ? optionId(active) : null"
             [value]="query" (input)="onQuery($any($event.target).value)" (keydown)="onKey($event)">
    </div>
    <!-- mousedown keeps the focus in the search box, so a click on a machine lands -->
    <ul [id]="uid + '-list'" role="listbox" aria-label="Machines" class="ms-list" (mousedown)="$event.preventDefault()">
      <li *ngFor="let m of shown; let i = index; trackBy: byId" [id]="optionId(i)" role="option" class="ms-item"
          [class.is-active]="i === active" [class.is-current]="m.machine_id === machineId"
          [attr.aria-selected]="m.machine_id === machineId" (click)="choose(m)" (mouseenter)="active = i">
        <i class="ms-dot" [attr.data-state]="state(m)" aria-hidden="true"></i>
        <span class="ms-item-name">{{ m.machine_serial_no }}</span>
        <span class="ms-item-state">{{ word(m) }}</span>
      </li>
    </ul>
    <p *ngIf="machines === null && !failed" class="ms-note" role="status">Loading machines…</p>
    <p *ngIf="machines === null && failed" class="ms-note" role="alert">
      The machines could not be loaded. <button type="button" class="ms-retry" (click)="load()">Try again</button>
    </p>
    <p *ngIf="machines !== null && !shown.length" class="ms-note">No machine matches “{{ query }}”.</p>
    <p class="sr-only" aria-live="polite">{{ spoken }}</p>
  </div>
  `
})
export class MachineSwitcherComponent implements OnInit, OnDestroy {
  @Input({ required: true }) machineId!: number;
  /** The machine's name as its page has it; empty while its data loads. */
  @Input() name = '';
  /** This machine's status and alarm as the page keeps them live: its dot in the list. */
  @Input() status = 'UNKNOWN';
  @Input() alarm = false;
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('search') search?: ElementRef<HTMLInputElement>;

  readonly uid = `ms${++nextUid}`;
  /** null until the list first arrives */
  machines: MachineChoice[] | null = null;
  failed = false;
  open = false;
  query = '';
  shown: MachineChoice[] = [];
  active = -1;
  spoken = '';
  /** An API without the list (an older server): the name stays plain text. */
  private noList = false;
  private loadedAt = 0;
  private sub?: Subscription;
  private offOutside?: () => void;

  constructor(private api: DashboardService, private router: Router, private renderer: Renderer2,
              private host: ElementRef<HTMLElement>, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void { this.sub?.unsubscribe(); this.offOutside?.(); }

  /** Only where there is another machine to go to. */
  get switchable(): boolean {
    return !this.noList && (this.machines === null || this.machines.some(m => m.machine_id !== this.machineId));
  }

  get label(): string {
    return this.name || this.machines?.find(m => m.machine_id === this.machineId)?.machine_serial_no || 'Machine';
  }

  optionId(i: number): string { return `${this.uid}-o${i}`; }
  byId(_: number, m: MachineChoice): number { return m.machine_id; }

  /** RUNNING, IDLE, ALARM or OFFLINE — this machine's from the page, which the socket keeps current. */
  state(m: MachineChoice): string {
    const mine = m.machine_id === this.machineId && STATES.has(this.status);
    if (mine ? this.alarm || this.status === 'ALARM' : m.alarm) return 'ALARM';
    const s = mine ? this.status : m.status;
    return STATES.has(s) ? s : 'OFFLINE';
  }
  word(m: MachineChoice): string { return WORD[this.state(m)]; }

  load(): void {
    this.sub?.unsubscribe();
    this.failed = false;
    this.sub = this.api.getLiveMachines().subscribe({
      next: (res: any) => {
        this.machines = Array.isArray(res?.data) ? res.data : [];
        this.loadedAt = Date.now();
        if (this.open && !this.switchable) this.close(false);
        else if (this.open) this.filter(this.shown[this.active]?.machine_id ?? this.machineId);
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        if (err?.status === 404) this.noList = true;
        else this.failed = true;
        this.cdr.markForCheck();
      }
    });
  }

  toggle(): void { this.open ? this.close(true) : this.show(); }

  /** ↓ or ↑ on the name opens the list too, as on a select. */
  onTriggerKey(e: KeyboardEvent): void {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !this.open) { e.preventDefault(); this.show(); }
  }

  onEscape(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.close(true);
  }

  private show(): void {
    this.open = true;
    this.query = '';
    this.spoken = '';
    this.filter(this.machineId);
    this.cdr.detectChanges();              // the panel is there to focus
    this.search?.nativeElement.focus();
    this.reveal();
    this.offOutside = this.renderer.listen('document', 'pointerdown', (e: Event) => {
      if (!this.host.nativeElement.contains(e.target as Node)) this.close(false);
    });
    if (this.machines === null || this.failed || Date.now() - this.loadedAt > FRESH_MS) this.load();
  }

  close(refocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.query = '';
    this.offOutside?.();
    this.offOutside = undefined;
    this.cdr.markForCheck();
    if (refocus) this.trigger?.nativeElement.focus();
  }

  choose(m: MachineChoice): void {
    this.close(true);
    if (m.machine_id !== this.machineId) this.router.navigate(['/dashboard/live', m.machine_id]);
  }

  onQuery(value: string): void {
    this.query = value;
    this.filter(null);
    const n = this.shown.length;
    this.spoken = !value.trim() ? '' : n ? `${n} machine${n === 1 ? '' : 's'}` : 'No machine matches';
    this.reveal();
  }

  onKey(e: KeyboardEvent): void {
    const step = ({ ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      if (!this.shown.length) return;
      this.active = Math.min(this.shown.length - 1, Math.max(0, this.active + step));
      this.reveal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active >= 0) this.choose(this.shown[this.active]);
    } else if (e.key === 'Tab') {
      this.close(false);
    }
  }

  /** Focus gone elsewhere (a screen reader, a click on something focusable): the list closes. */
  onFocusOut(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (to && !this.host.nativeElement.contains(to)) this.close(false);
  }

  /** The machines the search matches, in the list's order; the active one kept where it can be. */
  private filter(keep: number | null): void {
    const q = plainName(this.query);
    const all = this.machines || [];
    this.shown = q ? all.filter(m => plainName(m.machine_serial_no).includes(q)) : all;
    const at = keep == null ? -1 : this.shown.findIndex(m => m.machine_id === keep);
    this.active = at >= 0 ? at : this.shown.length ? 0 : -1;
  }

  /** The active machine in view: the list scrolls, not the page. */
  private reveal(): void {
    this.cdr.detectChanges();
    if (this.active < 0) return;
    this.host.nativeElement.querySelector<HTMLElement>('#' + this.optionId(this.active))?.scrollIntoView?.({ block: 'nearest' });
  }
}
