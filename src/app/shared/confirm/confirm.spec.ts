import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ConfirmService } from './confirm.service';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/*
 * The app's own "Are you sure?" in place of the browser's confirm(): one
 * question at a time, answered by its buttons, drawn in the same dialog
 * card as every other dialog.
 */
let fixture: ComponentFixture<ConfirmDialogComponent>;
let confirm: ConfirmService;
const el = () => fixture.nativeElement as HTMLElement;
const button = (text: string) =>
  Array.from(el().querySelectorAll('button')).find(b => b.textContent?.trim() === text) as HTMLButtonElement;

beforeEach(() => {
  TestBed.configureTestingModule({ imports: [ConfirmDialogComponent] });
  fixture = TestBed.createComponent(ConfirmDialogComponent);
  confirm = TestBed.inject(ConfirmService);
  fixture.detectChanges();
});
afterEach(() => fixture.destroy());

test('nothing is drawn until something asks', () => {
  expect(el().querySelector('.ui-overlay')).toBeNull();
});

test('the question is drawn as an alert dialog, and Delete answers yes', async () => {
  const answer = confirm.ask({ title: 'Delete the role "Shift lead"?', message: 'This cannot be undone.',
                               confirmText: 'Delete role', icon: 'delete_forever' });
  fixture.detectChanges();
  const dialog = el().querySelector('.ui-overlay .ui-dialog') as HTMLElement;
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(el().querySelector('#confirmTitle')?.textContent).toBe('Delete the role "Shift lead"?');
  expect(dialog.getAttribute('aria-describedby')).toBe('confirmBody');
  expect(el().querySelector('.ui-danger-icon')?.textContent?.trim()).toBe('delete_forever');
  expect(button('Delete role').classList).toContain('ui-btn-danger');

  button('Delete role').click();
  await expect(answer).resolves.toBe(true);
  fixture.detectChanges();
  expect(el().querySelector('.ui-overlay')).toBeNull();
});

test('Cancel answers no, and a non-destructive question has no warning badge', async () => {
  const answer = confirm.ask({ title: 'Activate "Acme"?', confirmText: 'Activate', tone: 'primary' });
  fixture.detectChanges();
  expect(el().querySelector('.ui-danger-icon')).toBeNull();
  expect(button('Activate').classList).toContain('ui-btn-primary');
  expect(el().querySelector('.ui-dialog')?.getAttribute('aria-describedby')).toBeNull();

  button('Cancel').click();
  await expect(answer).resolves.toBe(false);
});

test('listed consequences are shown one by one', () => {
  confirm.ask({ title: 'Permanently delete "Acme"?', message: 'This cannot be undone. It deletes:',
                items: ['All users in this company', 'All of its data'], confirmText: 'Delete permanently' });
  fixture.detectChanges();
  const items = Array.from(el().querySelectorAll('.cf-items li')).map(li => li.textContent);
  expect(items).toEqual(['All users in this company', 'All of its data']);
});

test('one question at a time: asking again answers the first no', async () => {
  const first = confirm.ask({ title: 'Remove A?', confirmText: 'Remove' });
  const second = confirm.ask({ title: 'Remove B?', confirmText: 'Remove' });
  await expect(first).resolves.toBe(false);
  fixture.detectChanges();
  expect(el().querySelector('#confirmTitle')?.textContent).toBe('Remove B?');
  button('Remove').click();
  await expect(second).resolves.toBe(true);
});
