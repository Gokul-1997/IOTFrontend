import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MultiOption, MultiSelectComponent } from './multi-select.component';

/* 28 Nov 2026, the user: "in component entry I need to select multiple machines". */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, MultiSelectComponent],
  template: `
    <label for="ms1">Machines</label>
    <app-multi-select inputId="ms1" [formControl]="machines" noun="machine" placeholder="Select machines"
                      [options]="options" describedBy="hint1"></app-multi-select>
    <p id="hint1">One component per machine</p>
    <button id="after">after</button>`
})
class Host {
  machines = new FormControl<number[]>([], { nonNullable: true, validators: Validators.required });
  options: MultiOption[] = [
    { value: 21, label: 'VMC - 1 - F' }, { value: 22, label: 'VMC - 2 - F' }, { value: 30, label: 'VMC - 12 - M' },
    { value: 31, label: 'VMC - 20 - M' }, { value: 40, label: 'HMC - 2' }
  ];
}

let fixture: ComponentFixture<Host>, host: Host, field: HTMLButtonElement;
beforeEach(async () => {
  TestBed.configureTestingModule({ imports: [Host] });
  fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  fixture.detectChanges();
  await fixture.whenStable();
  field = fixture.nativeElement.querySelector('button.ms-trigger');
});
afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); });

const panel = () => document.querySelector<HTMLElement>('.ms-panel');
const search = () => panel()!.querySelector<HTMLInputElement>('.ss-search input')!;
const rows = () => Array.from(panel()!.querySelectorAll('.mt-option-text')).map(el => el.textContent!.trim());
const ticks = () => Array.from(panel()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
const ticked = () => ticks().filter(t => t.checked).map(t => t.closest('label')!.textContent!.trim());
/** The chips a wide field shows (a narrow one: the first name and a count, .ms-narrow). */
const chips = () => Array.from(field.querySelectorAll('.ms-wide .ms-chip')).map(el => el.textContent!.trim());
const narrowChips = () => Array.from(field.querySelectorAll('.ms-narrow .ms-chip')).map(el => el.textContent!.trim());
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  fixture.detectChanges();
  return e;
};
const type = (text: string) => { search().value = text; search().dispatchEvent(new Event('input')); fixture.detectChanges(); };
const settle = async () => { fixture.detectChanges(); await new Promise(r => setTimeout(r)); fixture.detectChanges(); };
const open = async () => { field.click(); await settle(); };

test('a select\'s twin, named by its label; opens a searchable tick list with the search box focused', async () => {
  expect(field.textContent).toContain('Select machines');
  expect(field.getAttribute('aria-haspopup')).toBe('dialog');
  expect(field.getAttribute('aria-expanded')).toBe('false');
  expect(field.labels?.[0]?.textContent).toBe('Machines');
  expect(field.getAttribute('aria-describedby')).toBe('ms1-picked hint1');
  expect(document.getElementById('ms1-picked')!.textContent).toBe('No machines selected');

  await open();
  expect(field.getAttribute('aria-expanded')).toBe('true');
  expect(panel()!.getAttribute('role')).toBe('dialog');
  expect(panel()!.getAttribute('aria-label')).toBe('Choose machines');
  expect(rows()).toEqual(['VMC - 1 - F', 'VMC - 2 - F', 'VMC - 12 - M', 'VMC - 20 - M', 'HMC - 2']);
  expect(document.activeElement).toBe(search());
  expect(search().getAttribute('aria-label')).toBe('Search machines');
  expect(panel()!.textContent).toContain('0 of 5 selected');
});

test('ticks set the value at once, in the list\'s order; the field shows two chips and the rest as a count', async () => {
  await open();
  ticks()[3].click(); ticks()[0].click(); ticks()[1].click();
  fixture.detectChanges();
  expect(host.machines.value).toEqual([21, 22, 31]);
  expect(chips()).toEqual(['VMC - 1 - F', 'VMC - 2 - F', '+1']);
  expect(narrowChips()).toEqual(['VMC - 1 - F', '+2']);
  expect(field.querySelector('.ms-value')!.getAttribute('aria-hidden')).toBe('true');   // the summary says it once
  expect(panel()!.textContent).toContain('3 of 5 selected');
  expect(document.getElementById('ms1-picked')!.textContent).toBe('Selected: VMC - 1 - F, VMC - 2 - F, VMC - 20 - M');

  ticks()[0].click();
  fixture.detectChanges();
  expect(host.machines.value).toEqual([22, 31]);
});

test('search ignores case, spaces and dashes; Select shown takes what it found, Clear takes all off', async () => {
  await open();
  type('vmc2');
  expect(rows()).toEqual(['VMC - 2 - F', 'VMC - 20 - M']);
  const selectShown = Array.from(panel()!.querySelectorAll('button')).find(b => b.textContent!.trim() === 'Select shown')!;
  selectShown.click();
  fixture.detectChanges();
  expect(host.machines.value).toEqual([22, 31]);

  type('lathe');
  expect(panel()!.textContent).toContain('No machine matches “lathe”');

  type('');
  const selectAll = Array.from(panel()!.querySelectorAll('button')).find(b => b.textContent!.trim() === 'Select all')!;
  selectAll.click();
  fixture.detectChanges();
  expect(host.machines.value).toEqual([21, 22, 30, 31, 40]);
  expect(selectAll.disabled).toBe(true);                         // nothing left to add

  Array.from(panel()!.querySelectorAll('button')).find(b => b.textContent!.trim() === 'Clear')!.click();
  fixture.detectChanges();
  expect(host.machines.value).toEqual([]);
  expect(host.machines.invalid).toBe(true);
});

test('keyboard: a letter opens it searched, Enter ticks the first match, arrows move, Esc closes back to the field only', async () => {
  field.focus();
  press(field, 'h');
  await settle();
  expect(search().value).toBe('h');
  expect(rows()).toEqual(['VMC - 1 - F', 'VMC - 2 - F', 'VMC - 12 - M', 'VMC - 20 - M', 'HMC - 2'].filter(n => n.toLowerCase().includes('h')));

  type('hmc');
  press(search(), 'Enter');
  expect(host.machines.value).toEqual([40]);
  expect(ticked()).toEqual(['HMC - 2']);

  type('');
  press(search(), 'ArrowDown');
  expect(document.activeElement).toBe(ticks()[0]);
  press(ticks()[0], 'ArrowDown');
  expect(document.activeElement).toBe(ticks()[1]);
  press(ticks()[1], 'Enter');
  expect(host.machines.value).toEqual([22, 40]);
  press(ticks()[1], 'End');
  expect(document.activeElement).toBe(ticks()[4]);
  press(ticks()[4], 'Home');
  press(ticks()[0], 'ArrowUp');
  expect(document.activeElement).toBe(search());

  const outer = vi.fn();
  document.addEventListener('keydown', outer);                  // the dialog's own Esc must not hear it
  const esc = press(search(), 'Escape');
  document.removeEventListener('keydown', outer);
  expect(esc.defaultPrevented).toBe(true);
  expect(outer).not.toHaveBeenCalled();
  await settle();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(field);
  expect(host.machines.touched).toBe(true);
});

test('Tab past the last tick closes it on the field, so Tab moves on; a click outside closes it too', async () => {
  await open();
  const last = ticks().at(-1)!;
  last.focus();
  press(last, 'Tab');
  await settle();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(field);

  await open();
  press(search(), 'Tab', { shiftKey: true });
  await settle();
  expect(panel()).toBeNull();

  await open();
  document.getElementById('after')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  expect(panel()).toBeNull();
});

test('a value set by the form shows; a disabled field does not open', async () => {
  host.machines.setValue([30, 21]);
  fixture.detectChanges();
  expect(chips()).toEqual(['VMC - 1 - F', 'VMC - 12 - M']);

  host.machines.disable();
  fixture.detectChanges();
  expect(field.disabled).toBe(true);
  field.click();
  await settle();
  expect(panel()).toBeNull();
});

test('on a touch screen the search box waits to be tapped, so the keyboard does not cover the list', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }));
  await open();
  expect(document.activeElement).toBe(panel());
});
