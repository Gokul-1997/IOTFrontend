import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, Subscription, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/*
 * The report assistant ("STM Mexa AI" — the name comes from the server).
 *
 * The conversation lives here for the session, so it survives moving
 * between pages, and goes the moment the person signs out — on a shared
 * computer the next person must not see it. The server stores none of it.
 * The question being answered lives here too: the corner chat and the full
 * page (/assistant) show the same conversation, and a reply joins it
 * whichever of them is open when it comes (23 Oct 2026).
 *
 * Report pages say what they show (setContext): the assistant uses those
 * filters when a question does not name its own, and the chat says so.
 */

export interface AssistantAllowance {
  limit: number; used: number; remaining: number;
  resets_at: string; resets_text: string; timezone: string;
}
export interface AssistantStatus {
  name: string; enabled: boolean; reason?: string;
  welcome?: string; suggestions?: string[]; allowance?: AssistantAllowance;
}
export interface AssistantSource {
  report: string;
  period: { from: string; to: string } | null;
  filters: { machine?: string | null; shift?: string | null };
  view: string | null;
  download: { path: string; params: Record<string, string | number | undefined>; filename: string } | null;
}
export type AssistantKind = 'answer' | 'clarify' | 'out_of_scope' | 'restricted' | 'not_found' | 'limit';
/** sig: the server's signature for this person — sent back with the reply, or the server will not believe it was its own. */
export interface AssistantReply { kind: AssistantKind; text: string; sources: AssistantSource[]; allowance?: AssistantAllowance; sig?: string; }

/** What a report page shows: the report and its filters, as words. */
export interface AssistantContext {
  report: 'production' | 'oee-hourly' | 'shift-oee' | 'oee-records' | 'machine-oee';
  title: string;
  from?: string | null; to?: string | null;
  machine?: string | null; shift?: string | null;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
  /** error: the question failed; note: the app's own line (a download being emailed), not part of the conversation */
  kind?: AssistantKind | 'error' | 'note';
  sources?: AssistantSource[];
  /** The question an error was about, to ask again. */
  retry?: string;
  /** A reply's signature from the server, kept to send it back unchanged. */
  sig?: string;
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly api = `${environment.apiUrl}/assistant`;

  readonly messages$ = new BehaviorSubject<AssistantMessage[]>([]);
  readonly context$ = new BehaviorSubject<AssistantContext | null>(null);
  readonly status$ = new BehaviorSubject<AssistantStatus | null>(null);
  /** A question is being answered — one at a time (the server refuses a second). */
  readonly sending$ = new BehaviorSubject<boolean>(false);
  /** The server has no assistant yet (no AI key, or an older API): the chat says so instead of being missing. */
  readonly unavailable$ = new BehaviorSubject<boolean>(false);
  /** The corner chat should open: back from the full page, or a report opened from it. */
  readonly panelRequests$ = new Subject<void>();
  /** The page the full view was opened from, and the report filters it showed (that page clears them as it goes). */
  openedFrom: { url: string; context: AssistantContext | null } | null = null;

  private question?: Subscription;

  constructor() {
    // signing out (or in as someone else) leaves nothing of this conversation behind
    this.auth.sessionChanged$.subscribe(() => this.reset());
  }

  reset(): void {
    this.question?.unsubscribe();        // a reply still on its way joins nothing
    this.sending$.next(false);
    this.messages$.next([]);
    this.context$.next(null);
    this.status$.next(null);
    this.unavailable$.next(false);
    this.openedFrom = null;
  }

  /** May this person use the AI at all (AuthService holds the rule; the full page's guard asks it too). */
  mayUse(): boolean { return this.auth.mayUseAssistant(); }

  /** No questions now: not ready or not on, or today's allowance used up. */
  get closed(): boolean {
    const st = this.status$.value;
    return this.unavailable$.value || !st?.enabled || (!!st.allowance && st.allowance.remaining <= 0);
  }

  /** Ask; false when nothing was sent (empty, one already out, or closed). */
  send(text: string): boolean {
    const question = String(text || '').trim().slice(0, 500);
    if (!question || this.sending$.value || this.closed) return false;
    const history: AssistantMessage[] = [...this.messages$.value, { role: 'user', text: question }];
    this.messages$.next(history);
    this.put(history, question);
    return true;
  }

  /** The same question again, after a failure: the question stays, the error goes. */
  retry(failed: AssistantMessage): void {
    const at = this.messages$.value.indexOf(failed);
    if (this.sending$.value || !failed.retry || at < 0) return;
    const history = this.messages$.value.slice(0, at);
    this.messages$.next(history);
    this.put(history, failed.retry);
  }

  newChat(): void { this.messages$.next([]); }

  private put(history: AssistantMessage[], question: string): void {
    this.sending$.next(true);
    this.question = this.ask(history).subscribe({
      next: reply => {
        this.sending$.next(false);
        // the AI was taken away, or the person signed out, meanwhile: the late reply joins nothing
        const st = this.status$.value;
        if (!st) return;
        if (reply.allowance) this.status$.next({ ...st, allowance: reply.allowance });
        this.messages$.next([...this.messages$.value,
          { role: 'assistant', text: reply.text, kind: reply.kind, sources: reply.sources, sig: reply.sig }]);
      },
      error: err => {
        this.sending$.next(false);
        const st = this.status$.value;
        if (!st) return;
        const text = err?.error?.message || `${st.name || 'STM Mexa AI'} is not available right now. Please try again in a few minutes.`;
        this.messages$.next([...this.messages$.value, { role: 'assistant', text, kind: 'error', retry: question }]);
      }
    });
  }

  loadStatus(): Observable<AssistantStatus> {
    return this.http.get<{ data: AssistantStatus }>(`${this.api}/status`).pipe(map(r => {
      this.status$.next(r.data);
      return r.data;
    }));
  }

  /**
   * The conversation so far plus the question; the reply comes back with
   * today's allowance. Each reply goes back exactly as it came, with its
   * signature: the server believes no assistant turn it did not sign for
   * this person (22 Oct 2026 security review).
   */
  ask(messages: AssistantMessage[]): Observable<AssistantReply> {
    // the conversation as turns: errors and the app's notes left out; of two
    // turns in a row from the same side the newer stands (a question that
    // failed gives way to the one asked after it), so the turns alternate
    const turns: ({ role: 'user'; content: string } | { role: 'assistant'; content: string; sig?: string })[] = [];
    for (const m of messages) {
      if (m.kind === 'error' || m.kind === 'note' || !m.text) continue;
      const turn = m.role === 'assistant' ? { role: 'assistant' as const, content: m.text, ...(m.sig ? { sig: m.sig } : {}) }
                                          : { role: 'user' as const, content: m.text };
      if (turns.length && turns[turns.length - 1].role === m.role) turns[turns.length - 1] = turn;
      else turns.push(turn);
    }
    const ctx = this.context$.value;
    const context = ctx ? { report: ctx.report, from: ctx.from, to: ctx.to, machine: ctx.machine, shift: ctx.shift } : undefined;
    return this.http.post<{ data: AssistantReply }>(`${this.api}/chat`, { messages: turns, context }).pipe(map(r => r.data));
  }

  /** A report page says what it shows; null when it goes. */
  setContext(ctx: AssistantContext | null): void { this.context$.next(ctx); }

  /** The company admin's settings; company_daily_max is the platform's daily total for the whole company (seen, not set). */
  getSettings(): Observable<{ daily_limit: number; timezone: string; default_limit: number; max_limit: number; company_daily_max?: number }> {
    return this.http.get<any>(`${this.api}/settings`).pipe(map(r => r.data));
  }

  saveSettings(body: { daily_limit: number; timezone: string }): Observable<{ daily_limit: number; timezone: string }> {
    return this.http.put<any>(`${this.api}/settings`, body).pipe(map(r => r.data));
  }
}
