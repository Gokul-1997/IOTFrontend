import { Directive, ElementRef, HostListener, NgZone, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/*
 * A machine dropdown with a search box inside (29 Oct 2026, the user: "all
 * machine dropdowns: search inside, design not changed"). The <select> stays
 * as it is — its look, its form binding, its value — and only the list that
 * opens is ours: a search box over the same options, a little roomier than
 * the browser's. Picking one sets the select and fires its change event, so
 * ngModel, formControlName and (change) handlers work unchanged.
 *
 *   <select appSearchSelect class="mexa-select" [(ngModel)]="machine"> … </select>
 *
 * Used on every machine and operator dropdown (the user: "Operator dropdown
 * also"). Search ignores case, spaces and dashes: "vmc2" finds "VMC - 2 - F".
 * Keyboard: Enter, Space, ↑ or ↓ opens, and typing a letter opens it with
 * that letter searched; ↑ ↓ move; Enter picks; Esc closes; Tab moves on.
 * On a touch screen the phone's own picker opens, as before.
 * The list's look is global (styles/system.scss, .ss-panel): it is placed on
 * <body>, so it is never cut off by a card or a dialog.
 */
const plain = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
let uid = 0;

interface Item { index: number; text: string; key: string; disabled: boolean; }

@Directive({ selector: 'select[appSearchSelect]', standalone: true })
export class SearchSelectDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLSelectElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly id = `ss-${++uid}`;

  private panel: HTMLDivElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLUListElement;
  private items: Item[] = [];
  private shown: Item[] = [];
  private active = -1;
  private readonly cleanup: (() => void)[] = [];

  private get touch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || this.host.disabled || this.touch) return;
    e.preventDefault();                       // the browser's own list stays shut
    const wasOpen = !!this.panel;             // a second click closes it
    this.host.focus();
    wasOpen ? this.close() : this.open();
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (this.panel || this.host.disabled || this.touch || e.ctrlKey || e.metaKey) return;
    if (['Enter', ' ', 'F4', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      this.open();
    } else if (e.key.length === 1 && !e.altKey) {
      e.preventDefault();                     // the letter goes in the search, not the browser's jump-to
      this.open(e.key);
    }
  }

  ngOnDestroy(): void { this.close(false); }

  private open(typed = ''): void {
    this.items = Array.from(this.host.options).map((o, index) => ({
      index, text: (o.textContent || '').trim(), key: plain(o.textContent), disabled: o.disabled || o.hidden
    }));
    const panel = this.doc.createElement('div');
    panel.className = 'ss-panel';
    panel.innerHTML = `
      <div class="ss-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" autocomplete="off" spellcheck="false" />
      </div>
      <ul role="listbox"></ul>`;
    this.input = panel.querySelector('input')!;
    this.list = panel.querySelector('ul')!;
    this.list.id = `${this.id}-list`;
    this.input.setAttribute('aria-controls', this.list.id);
    const name = this.labelText();
    this.input.setAttribute('aria-label', name ? `Search ${name}` : 'Search');
    this.input.placeholder = 'Search…';
    this.list.setAttribute('aria-label', name || 'Options');
    this.doc.body.appendChild(panel);
    this.panel = panel;
    this.host.setAttribute('aria-expanded', 'true');
    this.input.value = typed;

    this.zone.runOutsideAngular(() => {
      const on = (target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
        target.addEventListener(type, fn, opts);
        this.cleanup.push(() => target.removeEventListener(type, fn, opts));
      };
      on(this.input, 'input', () => this.filter());
      on(this.input, 'keydown', (e: KeyboardEvent) => this.onPanelKey(e));
      on(this.input, 'focusout', (e: FocusEvent) => {                  // focus taken elsewhere: the list goes
        if (!panel.contains(e.relatedTarget as Node)) this.close(false);
      });
      on(this.list, 'mousedown', (e: MouseEvent) => e.preventDefault());   // keep the search box focused
      on(this.list, 'mousemove', (e: MouseEvent) => {
        const li = (e.target as HTMLElement).closest('li[data-index]');
        const n = li && !li.hasAttribute('aria-disabled') ? this.shown.findIndex(i => i.index === Number(li.getAttribute('data-index'))) : -1;
        if (n >= 0 && n !== this.active) { this.active = n; this.mark(false); }
      });
      on(this.list, 'click', (e: MouseEvent) => {
        const li = (e.target as HTMLElement).closest('li[data-index]');
        if (li && !li.hasAttribute('aria-disabled')) this.pick(Number(li.getAttribute('data-index')));
      });
      on(this.doc, 'mousedown', (e: MouseEvent) => {
        if (!panel.contains(e.target as Node) && e.target !== this.host) this.close(false);
      }, { capture: true });
      on(this.host, 'change', () => this.close(false));     // set some other way meanwhile
      on(window, 'resize', () => this.place());
      on(window, 'scroll', (e: Event) => { if (!panel.contains(e.target as Node)) this.place(); }, { capture: true, passive: true });
    });

    this.filter(this.host.selectedIndex);
    this.place();
    this.input.focus();
  }

  private close(refocus = true): void {
    this.cleanup.splice(0).forEach(fn => fn());
    this.panel?.remove();
    this.panel = null;
    this.host.setAttribute('aria-expanded', 'false');
    if (refocus) this.host.focus();
  }

  /** Under the select (above it when there is no room below), at least its width. */
  private place(): void {
    if (!this.panel) return;
    const r = this.host.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < 220 && above > below;
    const room = Math.max(160, Math.min(360, up ? above : below));
    Object.assign(this.panel.style, {
      left: `${left}px`, width: `${width}px`, maxHeight: `${room}px`,
      top: up ? '' : `${r.bottom + 4}px`, bottom: up ? `${window.innerHeight - r.top + 4}px` : ''
    });
  }

  private filter(keep: number = this.shown[this.active]?.index ?? -1): void {
    const q = plain(this.input.value);
    this.shown = q ? this.items.filter(i => i.key.includes(q)) : this.items;
    const at = this.shown.findIndex(i => i.index === keep && !i.disabled);
    this.active = at >= 0 ? at : this.shown.findIndex(i => !i.disabled);
    this.render();
  }

  private render(): void {
    const selected = this.host.selectedIndex;
    this.list.replaceChildren(...this.shown.map(item => {
      const li = this.doc.createElement('li');
      li.id = `${this.id}-o${item.index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(item.index));
      li.setAttribute('aria-selected', String(item.index === selected));
      if (item.disabled) li.setAttribute('aria-disabled', 'true');
      li.textContent = item.text;
      return li;
    }));
    if (!this.shown.length) {
      const li = this.doc.createElement('li');
      li.className = 'ss-none';
      li.textContent = 'No match';
      this.list.appendChild(li);
    }
    this.mark(true);
  }

  /** Highlight the active row (the keyboard's, or the one under the mouse). */
  private mark(scroll: boolean): void {
    this.list.querySelector('.is-active')?.classList.remove('is-active');
    const current = this.shown[this.active];
    const li = current ? this.list.querySelector<HTMLElement>(`li[data-index="${current.index}"]`) : null;
    if (li) {
      li.classList.add('is-active');
      this.input.setAttribute('aria-activedescendant', li.id);
      if (scroll) li.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private onPanelKey(e: KeyboardEvent): void {
    const move = (step: number) => {
      if (!this.shown.length) return;
      let n = this.active;
      for (let tries = 0; tries < this.shown.length; tries++) {
        n = (n + step + this.shown.length) % this.shown.length;
        if (!this.shown[n].disabled) break;
      }
      this.active = n;
      this.mark(true);
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home' && this.shown.length) { e.preventDefault(); this.active = -1; move(1); }
    else if (e.key === 'End' && this.shown.length) { e.preventDefault(); this.active = this.shown.length; move(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const current = this.shown[this.active];
      if (current && !current.disabled) this.pick(current.index);
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    else if (e.key === 'Tab') { this.close(); }            // from the select, so Tab moves on from it
  }

  /** Set the select as a person would, so every binding hears about it. */
  private pick(index: number): void {
    const changed = this.host.selectedIndex !== index;
    this.close();
    if (!changed) return;
    this.zone.run(() => {
      this.host.selectedIndex = index;
      this.host.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /** The select's label, for the search box and the list. */
  private labelText(): string {
    const label = this.host.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());   // the required-field star
    return (this.host.getAttribute('aria-label') || label?.textContent || '').trim();
  }
}
