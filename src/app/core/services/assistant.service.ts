import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/*
 * The report assistant ("STM Mexa AI" — the name comes from the server).
 *
 * The conversation lives here for the session, so it survives moving
 * between pages, and goes the moment the person signs out — on a shared
 * computer the next person must not see it. The server stores none of it.
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
export interface AssistantReply { kind: AssistantKind; text: string; sources: AssistantSource[]; allowance?: AssistantAllowance; }

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
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/assistant`;

  readonly messages$ = new BehaviorSubject<AssistantMessage[]>([]);
  readonly context$ = new BehaviorSubject<AssistantContext | null>(null);
  readonly status$ = new BehaviorSubject<AssistantStatus | null>(null);

  constructor() {
    // signing out (or in as someone else) leaves nothing of this conversation behind
    inject(AuthService).sessionChanged$.subscribe(() => this.reset());
  }

  reset(): void {
    this.messages$.next([]);
    this.context$.next(null);
    this.status$.next(null);
  }

  loadStatus(): Observable<AssistantStatus> {
    return this.http.get<{ data: AssistantStatus }>(`${this.api}/status`).pipe(map(r => {
      this.status$.next(r.data);
      return r.data;
    }));
  }

  /** The conversation so far plus the question; the reply comes back with today's allowance. */
  ask(messages: AssistantMessage[]): Observable<AssistantReply> {
    // the conversation as turns: errors and the app's notes left out; a question
    // that failed gives way to the one asked after it, so the turns alternate
    const turns: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of messages) {
      if (m.kind === 'error' || m.kind === 'note' || !m.text) continue;
      const last = turns[turns.length - 1];
      if (last && last.role === m.role) {
        if (m.role === 'user') last.content = m.text; else last.content += `\n${m.text}`;
      } else {
        turns.push({ role: m.role, content: m.text });
      }
    }
    const ctx = this.context$.value;
    const context = ctx ? { report: ctx.report, from: ctx.from, to: ctx.to, machine: ctx.machine, shift: ctx.shift } : undefined;
    return this.http.post<{ data: AssistantReply }>(`${this.api}/chat`, { messages: turns, context }).pipe(map(r => r.data));
  }

  /** A report page says what it shows; null when it goes. */
  setContext(ctx: AssistantContext | null): void { this.context$.next(ctx); }

  getSettings(): Observable<{ daily_limit: number; timezone: string; default_limit: number; max_limit: number }> {
    return this.http.get<any>(`${this.api}/settings`).pipe(map(r => r.data));
  }

  saveSettings(body: { daily_limit: number; timezone: string }): Observable<{ daily_limit: number; timezone: string }> {
    return this.http.put<any>(`${this.api}/settings`, body).pipe(map(r => r.data));
  }
}
