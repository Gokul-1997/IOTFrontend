import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SearchSelectDirective } from './search-select.directive';

@Component({
  standalone: true,
  imports: [FormsModule, SearchSelectDirective],
  template: `
    <label for="m">Machine</label>
    <select id="m" appSearchSelect [(ngModel)]="machine" (change)="changes = changes + 1">
      <option [ngValue]="null">All</option>
      @for (m of machines; track m.id) {
        <option [ngValue]="m.id" [disabled]="m.hold">{{ m.name }}</option>
      }
    </select>`
})
class Host {
  machine: number | null = 2;
  changes = 0;
  machines = [
    { id: 1, name: 'VMC - 1 - F' }, { id: 2, name: 'VMC - 2 - F' }, { id: 3, name: 'VMC - 12 - M', hold: true },
    { id: 4, name: 'VMC - 20 - M' }, { id: 5, name: 'HMC - 2' }
  ];
}

let fixture: ComponentFixture<Host>, select: HTMLSelectElement;
beforeEach(async () => {
  TestBed.configureTestingModule({ imports: [Host] });
  fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  select = fixture.nativeElement.querySelector('select');
});
afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); });

const panel = () => document.querySelector<HTMLElement>('.ss-panel');
const search = () => panel()!.querySelector('input')!;
const rows = () => Array.from(panel()!.querySelectorAll('li')).map(li => li.textContent);
const active = () => panel()!.querySelector('li.is-active')?.textContent;
const press = (el: Element, key: string) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const open = () => select.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
const type = (text: string) => { search().value = text; search().dispatchEvent(new Event('input')); };

test('the dropdown looks the same; clicking it opens a list with a search box, not the browser\'s', () => {
  expect(panel()).toBeNull();
  const shown = open();
  expect(shown).toBe(false);                                   // the browser's own list kept shut
  expect(rows()).toEqual(['All', 'VMC - 1 - F', 'VMC - 2 - F', 'VMC - 12 - M', 'VMC - 20 - M', 'HMC - 2']);
  expect(document.activeElement).toBe(search());
  expect(search().getAttribute('aria-label')).toBe('Search Machine');
  expect(panel()!.querySelector('[aria-selected="true"]')!.textContent).toBe('VMC - 2 - F');
  expect(active()).toBe('VMC - 2 - F');
  expect(select.getAttribute('aria-expanded')).toBe('true');
});

test('search ignores case, spaces and dashes; "vmc2" finds VMC - 2, not VMC - 12', () => {
  open();
  type('vmc2');
  expect(rows()).toEqual(['VMC - 2 - F', 'VMC - 20 - M']);
  type('  Hmc-2 ');
  expect(rows()).toEqual(['HMC - 2']);
  type('zzz');
  expect(rows()).toEqual(['No match']);
  expect(search().hasAttribute('aria-activedescendant')).toBe(false);
});

test('Enter picks the highlighted machine: the form value changes and (change) runs, once', async () => {
  open();
  type('hmc');
  press(search(), 'Enter');
  fixture.detectChanges();
  await fixture.whenStable();
  expect(fixture.componentInstance.machine).toBe(5);
  expect(fixture.componentInstance.changes).toBe(1);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(select);
  expect(select.getAttribute('aria-expanded')).toBe('false');
});

test('a click picks too; the arrows step over a machine that cannot be picked', () => {
  open();
  press(search(), 'ArrowDown');
  expect(active()).toBe('VMC - 20 - M');                        // VMC - 12 is disabled
  press(search(), 'ArrowUp');
  expect(active()).toBe('VMC - 2 - F');
  (panel()!.querySelectorAll('li')[1] as HTMLElement).click();
  expect(fixture.componentInstance.machine).toBe(1);
});

test('choosing the one already chosen changes nothing', () => {
  open();
  press(search(), 'Enter');
  expect(fixture.componentInstance.changes).toBe(0);
  expect(panel()).toBeNull();
});

test('Escape closes only the list — a dialog behind it stays open', () => {
  const pageHeard = vi.fn();
  document.addEventListener('keydown', pageHeard);
  open();
  const e = press(search(), 'Escape');
  document.removeEventListener('keydown', pageHeard);
  expect(e.defaultPrevented).toBe(true);
  expect(pageHeard).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(select);
  expect(fixture.componentInstance.machine).toBe(2);
});

test('from the keyboard: Enter or ↓ opens it, and typing a letter opens it searching for that letter', () => {
  select.focus();
  expect(press(select, 'ArrowDown').defaultPrevented).toBe(true);
  expect(panel()).not.toBeNull();
  press(search(), 'Escape');
  press(select, 'h');
  expect(search().value).toBe('h');
  expect(rows()).toEqual(['HMC - 2']);
});

test('a click outside closes it, a second click on the dropdown, focus taken elsewhere, the page going away', () => {
  open();
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(panel()).toBeNull();
  open();
  open();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(select);
  open();
  const other = document.body.appendChild(document.createElement('button'));
  other.focus();                                                // e.g. a dialog putting focus on its first field
  expect(panel()).toBeNull();
  other.remove();
  open();
  fixture.destroy();
  expect(panel()).toBeNull();
});

test('a disabled dropdown stays shut; on a touch screen the phone\'s own picker opens', () => {
  select.disabled = true;
  expect(open()).toBe(true);
  expect(panel()).toBeNull();
  select.disabled = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
  expect(open()).toBe(true);                                   // not prevented: the native picker
  expect(panel()).toBeNull();
});
