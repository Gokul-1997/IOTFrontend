import { AfterViewInit, Directive, ElementRef, OnDestroy, Renderer2 } from '@angular/core';

let nextId = 0;
const PHONE = '(max-width: 640px)';

/*
 * The filters in a page's title bar, folded away on a phone.
 *
 * On a phone the filters stacked one per row and filled most of the first
 * screen (266–342 px of title bar on Factory, OEE, Quality, Downtime) before
 * any figure appeared. Here they sit behind one button that reads back the
 * current choice — "Filters: All shifts · VMC - 12 - F · 29 Sep 2026" — and
 * fold away again after Submit so the results are what you see.
 *
 * Tablets and laptops are untouched: the button is hidden and the filters
 * show as before (the CSS in _mexa.scss keys everything to the phone width).
 *
 * Usage: add the directive to the element that already carries
 * class="mexa-filters". It adds its own toggle as the first child, so the
 * toggle is removed together with the filters if Angular removes them.
 */
@Directive({ selector: '[appFilterPanel]', standalone: true })
export class FilterPanelDirective implements AfterViewInit, OnDestroy {
  private button!: HTMLButtonElement;
  private summary!: HTMLSpanElement;
  private open = false;
  private timer?: ReturnType<typeof setInterval>;
  private unlisten: (() => void)[] = [];
  private mq = window.matchMedia(PHONE);

  constructor(private host: ElementRef<HTMLElement>, private r: Renderer2) {}

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    if (!el.id) el.id = `filters-${++nextId}`;
    this.r.addClass(el, 'mf-collapsible');

    this.button = this.r.createElement('button');
    this.r.setAttribute(this.button, 'type', 'button');
    this.r.addClass(this.button, 'mf-toggle');
    this.r.setAttribute(this.button, 'aria-controls', el.id);
    const icon = this.r.createElement('span');
    this.r.addClass(icon, 'material-icons');
    this.r.addClass(icon, 'mf-toggle-icon');
    this.r.setAttribute(icon, 'aria-hidden', 'true');
    this.r.appendChild(icon, this.r.createText('tune'));
    const label = this.r.createElement('span');
    this.r.addClass(label, 'mf-toggle-label');
    this.r.appendChild(label, this.r.createText('Filters'));
    this.summary = this.r.createElement('span');
    this.r.addClass(this.summary, 'mf-toggle-summary');
    const chevron = this.r.createElement('span');
    this.r.addClass(chevron, 'material-icons');
    this.r.addClass(chevron, 'mf-toggle-chevron');
    this.r.setAttribute(chevron, 'aria-hidden', 'true');
    this.r.appendChild(chevron, this.r.createText('expand_more'));
    [icon, label, this.summary, chevron].forEach(n => this.r.appendChild(this.button, n));
    this.r.insertBefore(el, this.button, el.firstChild);

    this.unlisten.push(this.r.listen(this.button, 'click', () => this.set(!this.open)));
    this.unlisten.push(this.r.listen(el, 'change', () => this.refresh()));
    this.unlisten.push(this.r.listen(el, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.open && this.mq.matches) { this.set(false); this.button.focus(); }
    }));
    // Submit applies the filters: fold them away so the results are in view
    const form = el.closest('form');
    if (form) this.unlisten.push(this.r.listen(form, 'submit', () => { if (this.mq.matches) this.set(false); }));
    this.unlisten.push(this.r.listen(el, 'click', (e: Event) => {
      const t = e.target as HTMLElement;
      if (this.mq.matches && t.closest('.mexa-submit, [type=submit], [data-filter-apply]') && !form) setTimeout(() => this.set(false));
    }));

    this.set(false);
    /* Selections set by code (a default machine picked after the data
       loads) fire no DOM event, so the summary re-reads now and then. */
    this.timer = setInterval(() => this.refresh(), 1500);
  }

  private set(open: boolean): void {
    this.open = open;
    this.r.setAttribute(this.button, 'aria-expanded', String(open));
    open ? this.r.addClass(this.host.nativeElement, 'is-open') : this.r.removeClass(this.host.nativeElement, 'is-open');
    this.refresh();
  }

  /** "Shift: All · Machine: VMC - 12 - F · 29 Sep 2026" — what the filters are set to. */
  private refresh(): void {
    if (!this.summary) return;
    const host = this.host.nativeElement;
    const labelOf = (f: HTMLElement): string => {
      const byFor = f.id ? host.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(f.id)}"]`) : null;
      const prev = f.previousElementSibling as HTMLElement | null;
      const text = (byFor?.textContent || (prev?.classList.contains('mexa-filter-label') ? prev.textContent : '') || '').trim();
      return text.replace(/:$/, '');
    };
    const day = (v: string) => {
      const d = new Date(v + 'T00:00:00');
      return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const parts: string[] = [];
    const dates: string[] = [];
    host.querySelectorAll<HTMLSelectElement | HTMLInputElement>('select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')
      .forEach(f => {
        if (f.closest('.mf-toggle')) return;
        if (f instanceof HTMLSelectElement) {
          const t = f.selectedOptions[0]?.text?.trim();
          if (!t) return;
          const l = labelOf(f);
          parts.push(l ? `${l}: ${t}` : t);
        } else if (f.type === 'date') {
          if (f.value) dates.push(day(f.value));
        } else if (f.value && f.type !== 'search') {
          const l = labelOf(f);
          parts.push(l ? `${l}: ${f.value}` : f.value);
        }
      });
    // a From–To pair reads as one range
    if (dates.length) parts.push(dates.join(' – '));
    const text = parts.join(' · ');
    if (this.summary.textContent !== text) this.summary.textContent = text;
    this.r.setAttribute(this.button, 'aria-label', `${this.open ? 'Hide' : 'Show'} filters${text ? ': ' + text : ''}`);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.unlisten.forEach(u => u());
  }
}
