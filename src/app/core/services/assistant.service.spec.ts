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
