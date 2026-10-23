import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { AssistantService } from './assistant.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/* The report assistant's conversation: what goes to the server, and that it goes on sign-out. */
const session$ = new Subject<'signed-in' | 'signed-out'>();
function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
    { provide: AuthService, useValue: { sessionChanged$: session$ } }] });
  return { svc: TestBed.inject(AssistantService), http: TestBed.inject(HttpTestingController) };
}
afterEach(() => TestBed.resetTestingModule());

test('only the conversation goes: errors and the app\'s notes are left out, and a failed question gives way to the next', () => {
  const { svc, http } = setup();
  svc.setContext({ report: 'production', title: 'Production report', from: '2026-10-21', to: '2026-10-22', machine: 'VMC-1', shift: null });
  svc.ask([
    { role: 'user', text: 'Production today' },
    { role: 'assistant', text: 'busy', kind: 'error', retry: 'Production today' },
    { role: 'user', text: 'Production yesterday' },
    { role: 'assistant', text: '40 pcs', kind: 'answer', sig: 'S1' },
    { role: 'assistant', text: 'The report is being emailed…', kind: 'note' },
    { role: 'user', text: 'And by shift?' }
  ]).subscribe();
  const req = http.expectOne(`${environment.apiUrl}/assistant/chat`);
  expect(req.request.body).toEqual({
    // each reply goes back exactly as it came, with the server's signature
    messages: [{ role: 'user', content: 'Production yesterday' }, { role: 'assistant', content: '40 pcs', sig: 'S1' }, { role: 'user', content: 'And by shift?' }],
    context: { report: 'production', from: '2026-10-21', to: '2026-10-22', machine: 'VMC-1', shift: null }
  });
  req.flush({ data: { kind: 'answer', text: 'ok', sources: [] } });
  http.verify();
});

test('signing out leaves nothing of the conversation behind', () => {
  const { svc } = setup();
  svc.messages$.next([{ role: 'user', text: 'secret question' }]);
  svc.setContext({ report: 'production', title: 'Production report' });
  session$.next('signed-out');
  expect(svc.messages$.value).toEqual([]);
  expect(svc.context$.value).toBeNull();
  expect(svc.status$.value).toBeNull();
});

/* Asking: the corner chat and the full page (/assistant) share one conversation — the service asks, so a reply
   joins it whichever of them is open when it comes (23 Oct 2026). */
const READY = { name: 'Mexa AI', enabled: true,
  allowance: { limit: 50, used: 12, remaining: 38, resets_at: '', resets_text: '12:00 am', timezone: 'Asia/Kolkata' } };
const chat = `${environment.apiUrl}/assistant/chat`;

test('a question: one at a time; the reply joins the conversation with today\'s allowance', () => {
  const { svc, http } = setup();
  svc.status$.next(READY);
  expect(svc.send('  Production today?  ')).toBe(true);
  expect(svc.messages$.value).toEqual([{ role: 'user', text: 'Production today?' }]);
  expect(svc.sending$.value).toBe(true);
  expect(svc.send('And yesterday?')).toBe(false);                 // the server refuses a second while one is out
  http.expectOne(chat).flush({ data: { kind: 'answer', text: '65 pcs', sources: [], sig: 'S1',
    allowance: { ...READY.allowance, used: 13, remaining: 37 } } });
  expect(svc.sending$.value).toBe(false);
  expect(svc.messages$.value[1]).toEqual({ role: 'assistant', text: '65 pcs', kind: 'answer', sources: [], sig: 'S1' });
  expect(svc.status$.value?.allowance?.remaining).toBe(37);
  http.verify();
});

test('nothing goes before the chat is ready, when it is off, or when today\'s allowance is used up', () => {
  const { svc, http } = setup();
  expect(svc.send('Production today?')).toBe(false);              // status not loaded yet (the full page opened directly)
  svc.status$.next({ name: 'Mexa AI', enabled: false, reason: 'SWITCHED_OFF' });
  expect(svc.send('Production today?')).toBe(false);
  svc.status$.next({ ...READY, allowance: { ...READY.allowance, used: 50, remaining: 0 } });
  expect(svc.send('Production today?')).toBe(false);
  svc.status$.next(READY);
  svc.unavailable$.next(true);
  expect(svc.send('Production today?')).toBe(false);
  expect(svc.send('   ')).toBe(false);
  http.expectNone(chat);
  expect(svc.messages$.value).toEqual([]);
});

test('a failure says so and can be asked again: the error goes, the question stays', () => {
  const { svc, http } = setup();
  svc.status$.next(READY);
  svc.send('Production today?');
  http.expectOne(chat).flush({ message: 'Mexa AI is busy.' }, { status: 503, statusText: 'Service Unavailable' });
  const failed = svc.messages$.value[1];
  expect(failed).toEqual({ role: 'assistant', text: 'Mexa AI is busy.', kind: 'error', retry: 'Production today?' });
  svc.retry(failed);
  expect(svc.messages$.value).toEqual([{ role: 'user', text: 'Production today?' }]);
  expect(http.expectOne(chat).request.body.messages).toEqual([{ role: 'user', content: 'Production today?' }]);
  http.verify();
});

test('signed out while a question is out: the request is dropped and its reply never joins', () => {
  const { svc, http } = setup();
  svc.status$.next(READY);
  svc.send('Production today?');
  const req = http.expectOne(chat);
  session$.next('signed-out');
  expect(req.cancelled).toBe(true);
  expect(svc.sending$.value).toBe(false);
  expect(svc.messages$.value).toEqual([]);
});

test('a new chat starts empty', () => {
  const { svc } = setup();
  svc.messages$.next([{ role: 'user', text: 'Production today?' }]);
  svc.newChat();
  expect(svc.messages$.value).toEqual([]);
});

test('two replies in a row are never joined into one: the newer stands, with its own signature', () => {
  const { svc, http } = setup();
  svc.ask([
    { role: 'user', text: 'Production today' },
    { role: 'assistant', text: 'Which machine?', kind: 'clarify', sig: 'S1' },
    { role: 'assistant', text: 'Today 65 parts.', kind: 'answer', sig: 'S2' },
    { role: 'user', text: 'And yesterday?' }
  ]).subscribe();
  const req = http.expectOne(`${environment.apiUrl}/assistant/chat`);
  expect(req.request.body.messages).toEqual([{ role: 'user', content: 'Production today' },
    { role: 'assistant', content: 'Today 65 parts.', sig: 'S2' }, { role: 'user', content: 'And yesterday?' }]);
  req.flush({ data: { kind: 'answer', text: 'ok', sources: [] } });
  http.verify();
});
