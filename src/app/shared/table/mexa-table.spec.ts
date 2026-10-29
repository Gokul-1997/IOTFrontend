import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { MEXA_TABLE } from './mexa-table';
import { TableState } from './table-state';

@Component({
  standalone: true,
  imports: [...MEXA_TABLE],
  template: `
    <table class="mexa-table" [mexaTable]="tbl">
      <thead><tr>
        <th mexaCol="machine">Machine</th>
        <th mexaCol="status">Status</th>
        <th mexaCol="actions"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>
        @for (r of rows | tableView:tbl:tbl.version; track r.machine) {
          <tr><td>{{ r.machine }}</td><td>{{ r.status }}</td><td></td></tr>
        }
      </tbody>
    </table>`
})
class Host {
  rows = [
    { machine: 'VMC - 10 - M', status: 'OPEN' }, { machine: 'VMC - 2 - F', status: 'CLOSED' }, { machine: 'HMC - 1', status: 'OPEN' }
  ];
  tbl = new TableState<any>([
    { key: 'machine' }, { key: 'status', filter: 'list' }, { key: 'actions', sort: false }
  ]);
}

let fixture: ComponentFixture<Host>, el: HTMLElement;
beforeEach(async () => {
  TestBed.configureTestingModule({ imports: [Host] });
  fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  el = fixture.nativeElement;
});
afterEach(() => fixture.destroy());

const th = (n: number) => el.querySelectorAll('th')[n] as HTMLElement;
const cells = () => [...el.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')!.textContent);
const render = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };

test('a sortable header is one button; aria-sort follows it; the sorted column is marked for its tint', async () => {
  const sort = th(0).querySelector<HTMLButtonElement>('button.mt-sort')!;
  expect(sort.textContent?.trim()).toBe('Machine');
  expect(th(0).getAttribute('aria-sort')).toBe('none');
  expect(sort.title).toBe('Sort ascending');
  sort.click(); await render();
  expect(th(0).getAttribute('aria-sort')).toBe('ascending');
  expect(th(0).classList).toContain('is-sorted');
  expect(cells()).toEqual(['HMC - 1', 'VMC - 2 - F', 'VMC - 10 - M']);
  expect(el.querySelector('table')!.getAttribute('data-sorted-col')).toBe('1');
  sort.click(); await render();
  expect(th(0).getAttribute('aria-sort')).toBe('descending');
  // sorting another column takes the sort (and its carets) away from this one
  th(1).querySelector<HTMLButtonElement>('button.mt-sort')!.click(); await render();
  expect(th(0).getAttribute('aria-sort')).toBe('none');
  expect(th(0).querySelector('.mt-caret.on')).toBeNull();
  expect(el.querySelector('table')!.getAttribute('data-sorted-col')).toBe('2');
});

test('a column that does not sort has no button and no aria-sort', () => {
  expect(th(2).querySelector('button')).toBeNull();
  expect(th(2).hasAttribute('aria-sort')).toBe(false);
});

test('the funnel says what it filters; a column without a filter has none, and no search box anywhere', () => {
  const funnel = th(1).querySelector<HTMLButtonElement>('button.mt-filter')!;
  expect(funnel.getAttribute('aria-label')).toBe('Filter Status');
  expect(funnel.getAttribute('aria-expanded')).toBe('false');
  expect(funnel.getAttribute('aria-haspopup')).toBe('dialog');
  expect(th(0).querySelector('button.mt-filter')).toBeNull();
  expect(el.querySelector('input[type=search]')).toBeNull();
});

test('ticking a value filters at once; Clear takes it off', async () => {
  th(1).querySelector<HTMLButtonElement>('button.mt-filter')!.click(); await render();
  const panel = document.querySelector('.mt-panel') as HTMLElement;
  expect(panel.getAttribute('role')).toBe('dialog');
  const labels = [...panel.querySelectorAll('.mt-option')].map(l =>
    [l.querySelector('.mt-option-text')!.textContent!.trim(), l.querySelector('.mt-count')!.textContent!.trim()]);
  expect(labels).toEqual([['CLOSED', '1'], ['OPEN', '2']]);
  (panel.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement).click(); await render();
  expect(cells()).toEqual(['VMC - 10 - M', 'HMC - 1']);
  expect(th(1).classList).toContain('is-filtered');
  expect(th(1).querySelector('button.mt-filter')!.getAttribute('aria-label')).toBe('Filter Status (on)');
  (panel.querySelector('.mt-clear') as HTMLButtonElement).click(); await render();
  expect(cells()).toHaveLength(3);
});

test('the filter list has tick boxes only — no search box inside the table', async () => {
  th(1).querySelector<HTMLButtonElement>('button.mt-filter')!.click(); await render();
  expect(document.querySelector('.mt-panel input[type=search]')).toBeNull();
  expect(document.querySelectorAll('.mt-panel input[type=checkbox]')).toHaveLength(2);
});
