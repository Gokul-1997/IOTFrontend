import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { MachineSwitcherComponent, plainName } from './machine-switcher.component';
import { DashboardService } from '../dashboard.service';

/* The machine page's name as a dropdown of the other machines, with a search
   box (23 Oct 2026, the user: going back to the Live Dashboard for each
   machine was slow). */

const MACHINES = [
  { machine_id: 21, machine_serial_no: 'VMC - 1 - F', status: 'RUNNING', alarm: false },
  { machine_id: 25, machine_serial_no: 'HMC - 7 - F', status: 'IDLE', alarm: false },
  { machine_id: 30, machine_serial_no: 'VMC - 12 - F', status: 'IDLE', alarm: true },
  { machine_id: 31, machine_serial_no: 'Lathe 3', status: 'OFFLINE', alarm: false }
];

let fixture: ComponentFixture<MachineSwitcherComponent>, sw: MachineSwitcherComponent;
let api: { getLiveMachines: ReturnType<typeof vi.fn> }, router: { navigate: ReturnType<typeof vi.fn> };

function make(list: Observable<any> = of({ status: 'success', data: MACHINES }), machineId = 25) {
  api = { getLiveMachines: vi.fn().mockReturnValue(list) };
  router = { navigate: vi.fn() };
  TestBed.configureTestingModule({ imports: [MachineSwitcherComponent], providers: [
    { provide: DashboardService, useValue: api }, { provide: Router, useValue: router }
  ] });
  fixture = TestBed.createComponent(MachineSwitcherComponent);
  sw = fixture.componentInstance;
  sw.machineId = machineId;
  sw.name = 'HMC - 7 - F';
  fixture.detectChanges();
}
afterEach(() => fixture?.destroy());

const el = (): HTMLElement => fixture.nativeElement;
const trigger = () => el().querySelector<HTMLButtonElement>('.ms-trigger');
const search = () => el().querySelector<HTMLInputElement>('input[role="combobox"]')!;
const options = () => [...el().querySelectorAll<HTMLElement>('[role="option"]')];
const press = (target: HTMLElement, key: string) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  fixture.detectChanges();
};
const type = (value: string) => {
  search().value = value;
  search().dispatchEvent(new Event('input'));
  fixture.detectChanges();
};
function openList() {
  trigger()!.click();
  fixture.detectChanges();
}

test('a search finds a machine however its name is spaced or dashed', () => {
  expect(plainName('VMC - 12 - F')).toBe('vmc12f');
  expect(plainName('vmc12')).toBe('vmc12');
  expect(plainName(null)).toBe('');
});

test('the name opens the machines on the search box, this one chosen; ↓ and Enter open the next', () => {
  make();
  expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  expect(el().querySelector('h1')?.textContent).toContain('HMC - 7 - F');
  openList();

  expect(trigger()!.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(search());
  expect(options().map(o => o.querySelector('.ms-item-name')!.textContent)).toEqual(['VMC - 1 - F', 'HMC - 7 - F', 'VMC - 12 - F', 'Lathe 3']);
  const current = options()[1];
  expect(current.getAttribute('aria-selected')).toBe('true');
  expect(search().getAttribute('aria-activedescendant')).toBe(current.id);

  press(search(), 'ArrowDown');
  expect(search().getAttribute('aria-activedescendant')).toBe(options()[2].id);
  press(search(), 'Enter');
  expect(router.navigate).toHaveBeenCalledWith(['/dashboard/live', 30]);
  expect(el().querySelector('.ms-panel')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test('typing narrows the list; Enter opens the first match; nothing found says so', () => {
  make();
  openList();
  type('vmc12');
  expect(options().map(o => o.querySelector('.ms-item-name')!.textContent)).toEqual(['VMC - 12 - F']);
  expect(el().querySelector('[aria-live]')?.textContent).toBe('1 machine');
  type('zzz');
  expect(options()).toHaveLength(0);
  expect(el().querySelector('.ms-note')?.textContent).toContain('No machine matches “zzz”.');
  type('lathe');
  press(search(), 'Enter');
  expect(router.navigate).toHaveBeenCalledWith(['/dashboard/live', 31]);
});

test('each machine shows its status in words; this one follows the page, which the socket keeps live', () => {
  make();
  fixture.componentRef.setInput('status', 'RUNNING');
  openList();
  const words = options().map(o => o.querySelector('.ms-item-state')!.textContent);
  expect(words).toEqual(['Running', 'Running', 'Alarm', 'Offline']);
  expect(options()[2].querySelector('.ms-dot')!.getAttribute('data-state')).toBe('ALARM');
});

test('Esc, a click elsewhere, or this machine again closes the list and opens nothing', () => {
  make();
  openList();
  press(search(), 'Escape');
  expect(el().querySelector('.ms-panel')).toBeNull();
  expect(document.activeElement).toBe(trigger());

  openList();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  fixture.detectChanges();
  expect(el().querySelector('.ms-panel')).toBeNull();

  openList();
  options()[1].click();
  fixture.detectChanges();
  expect(el().querySelector('.ms-panel')).toBeNull();
  expect(router.navigate).not.toHaveBeenCalled();
});

test('↓ on the name opens the list too', () => {
  make();
  press(trigger()!, 'ArrowDown');
  expect(el().querySelector('.ms-panel')).not.toBeNull();
  expect(document.activeElement).toBe(search());
});

test('with no other machine, or an API without the list, the name is plain text as before', () => {
  make(of({ status: 'success', data: [MACHINES[1]] }));
  expect(trigger()).toBeNull();
  expect(el().querySelector('h1')?.textContent?.trim()).toBe('HMC - 7 - F');
  fixture.destroy();
  TestBed.resetTestingModule();

  make(throwError(() => ({ status: 404 })));
  expect(trigger()).toBeNull();
  expect(el().querySelector('h1')?.textContent?.trim()).toBe('HMC - 7 - F');
});

test('a list that failed to load says so in the dropdown and can be asked for again', () => {
  make(throwError(() => ({ status: 503 })));
  expect(trigger()).not.toBeNull();
  api.getLiveMachines.mockReturnValue(throwError(() => ({ status: 503 })));
  openList();
  expect(el().querySelector('[role="alert"]')?.textContent).toContain('The machines could not be loaded.');
  api.getLiveMachines.mockReturnValue(of({ status: 'success', data: MACHINES }));
  el().querySelector<HTMLButtonElement>('.ms-retry')!.click();
  fixture.detectChanges();
  expect(options()).toHaveLength(4);
});

test('while the machine\'s own data loads, its name comes from the list', () => {
  make();
  fixture.componentRef.setInput('name', '');
  fixture.componentRef.setInput('machineId', 30);
  fixture.detectChanges();
  expect(el().querySelector('h1')?.textContent).toContain('VMC - 12 - F');
});
