import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, Injector, OnInit, ViewChild,
         afterNextRender, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AssistantContext, AssistantMessage, AssistantService, AssistantSource, AssistantStatus } from '../../core/services/assistant.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { downloadError, saveOrMessage } from '../report-file';
import { dayText } from '../report-value';

/** Downloads the assistant may start: the report files, nothing else. */
const DOWNLOADS = /^\/(reports\/(production|hourly-oee|shift-oee)|dashboard\/oee\/export\/xlsx)$/;
const WELCOMED = 'mexa-assistant-welcomed';

/** A reply as the chat lays it out: paragraphs, and lines starting "- " or "1." as lists. Text only — never HTML. */
export type AssistantBlock = { p: string } | { ul: string[] } | { ol: string[] };
export function toBlocks(text: string): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  for (const raw of String(text || '').replace(/\*\*/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+(.+)$/.exec(line);
    const step = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) { if (last && 'ul' in last) last.ul.push(bullet[1]); else out.push({ ul: [bullet[1]] }); }
    else if (step) { if (last && 'ol' in last) last.ol.push(step[1]); else out.push({ ol: [step[1]] }); }
    else out.push({ p: line });
  }
  return out;
}

/** An icon for a suggested question, from what it is about. */
const ICONS: [RegExp, string][] = [
  [/running|right now/i, 'sensors'], [/oee/i, 'speed'], [/alarm/i, 'notifications_active'],
  [/maintenance|ticket/i, 'handyman'], [/downtime/i, 'timer_off'], [/program/i, 'swap_horiz'], [/energy/i, 'bolt'],
  [/how do i|where/i, 'help_outline'], [/production|shift/i, 'precision_manufacturing'], [/company/i, 'apartment']
];

/*
 * The company assistant in the corner of every signed-in page ("STM Mexa
 * AI" — the server names it): for a company S&T gave it to, and the roles
 * its admin gave it to (23 Oct 2026); what it can answer follows the
 * person's role. A click opens the chat over the page without leaving it.
 * The launcher greets once per session with one soft glow — no bouncing, no
 * chat opening by itself, and no motion at all for anyone who asked for less.
 */
@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assistant-widget.component.html',
  styleUrl: './assistant-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Escape anywhere in the widget — the launcher too — closes the chat
  host: { '[class.is-open]': 'open', '(keydown.escape)': 'open && close()' }
})
export class AssistantWidgetComponent implements OnInit {
  private readonly svc = inject(AssistantService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('launcher') launcher?: ElementRef<HTMLButtonElement>;
  @ViewChild('input') input?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('log') log?: ElementRef<HTMLElement>;

  status: AssistantStatus | null = null;
  messages: AssistantMessage[] = [];
  context: AssistantContext | null = null;
  open = false;
  draft = '';
  sending = false;
  downloading: AssistantSource | null = null;
  /** The launcher's one greeting this session. */
  greet = false;
  /**
   * The server has no assistant yet (no AI key, or not deployed): the
   * launcher still shows, and the chat says it is not on yet instead of the
   * button being missing with no reason (22 Oct 2026).
   */
  unavailable = false;

  get name(): string { return this.status?.name || 'STM Mexa AI'; }
  /** "How can I help, Ravi?" */
  get greeting(): string {
    const who = String(this.auth.getUser()?.username || '').trim().split(/\s+/)[0];
    return who ? `How can I help, ${who}?` : 'How can I help?';
  }
  /** For everyone in a company: on, or not set up yet. Hidden when the company admin switched it off, or for S&T. */
  get visible(): boolean { return !!this.status?.enabled || this.unavailable; }
  get allowance() { return this.status?.allowance; }
  get limitReached(): boolean { return !!this.allowance && this.allowance.remaining <= 0; }
  get closed(): boolean { return this.unavailable || this.limitReached; }
  get asked(): boolean { return this.messages.some(m => m.role === 'user'); }
  get suggestions(): string[] { return this.status?.suggestions || []; }

  ngOnInit(): void {
    this.svc.messages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(m => { this.messages = m; this.cdr.markForCheck(); });
    this.svc.context$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(c => { this.context = c; this.cdr.markForCheck(); });
    this.svc.status$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(s => { this.status = s; this.cdr.markForCheck(); });
    this.auth.sessionChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.open = false; this.load(); });
    // S&T gave or took the AI, or the company admin changed this person's role,
    // while they are signed in: the button follows without signing in again
    this.auth.grantsChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.recheck());
    this.load();
  }

  /**
   * Only where S&T gave the company the AI in Manage Access and the company
   * admin gave it to this person's role (the company admin has it with the
   * company) — never S&T itself.
   */
  private mayUse(): boolean {
    return this.auth.isLoggedIn() && !this.auth.isSntSuper() && !!this.auth.getUser()?.company_id
      && this.auth.hasPermission('page:assistant');
  }

  /** For someone who may use it: whether the server has it on. */
  private load(): void {
    this.unavailable = false;
    if (!this.mayUse()) return;
    this.svc.loadStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.unavailable = !s.enabled && s.reason === 'NOT_CONFIGURED';
        if (s.enabled) {
          try { this.greet = !sessionStorage.getItem(WELCOMED); sessionStorage.setItem(WELCOMED, '1'); } catch { this.greet = false; }
        }
        this.cdr.markForCheck();
      },
      // the server does not have the assistant yet (an older API): say so in the chat
      error: err => { this.unavailable = err?.status === 404 || err?.status === 0 || err?.status >= 500; this.cdr.markForCheck(); }
    });
  }

  /** Given now: the button comes. Taken away: the button, the chat and its conversation go. */
  private recheck(): void {
    if (this.mayUse()) {
      if (!this.status && !this.unavailable) this.load();
      return;
    }
    this.open = false;
    this.unavailable = false;
    this.svc.messages$.next([]);
    this.svc.status$.next(null);
    this.cdr.markForCheck();
  }

  openPanel(): void {
    this.open = true;
    this.greet = false;
    this.cdr.markForCheck();
    this.afterRender(() => { this.input?.nativeElement.focus(); this.scrollToEnd(); });
  }

  close(): void {
    this.open = false;
    this.cdr.markForCheck();
    this.afterRender(() => this.launcher?.nativeElement.focus());
  }

  newChat(): void {
    this.svc.messages$.next([]);
    this.afterRender(() => this.input?.nativeElement.focus());
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
  }

  /** The question box grows with what is typed, up to five lines. */
  grow(): void {
    const el = this.input?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  send(text: string = this.draft): void {
    const question = text.trim().slice(0, 500);
    if (!question || this.sending || this.closed) return;
    this.draft = '';
    this.afterRender(() => this.grow());
    const history: AssistantMessage[] = [...this.messages, { role: 'user', text: question }];
    this.svc.messages$.next(history);
    this.ask(history, question);
  }

  /** The same question again, after a failure. */
  retry(failed: AssistantMessage): void {
    if (this.sending || !failed.retry) return;
    const at = this.messages.indexOf(failed);
    const history = this.messages.slice(0, at);                     // the question stays; the error goes
    this.svc.messages$.next(history);
    this.ask(history, failed.retry);
  }

  private ask(history: AssistantMessage[], question: string): void {
    this.sending = true;
    this.cdr.markForCheck();
    this.afterRender(() => this.scrollToEnd());
    this.svc.ask(history).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: reply => {
        this.sending = false;
        if (this.droppedMeanwhile()) return;
        if (reply.allowance && this.status) this.svc.status$.next({ ...this.status, allowance: reply.allowance });
        this.svc.messages$.next([...this.svc.messages$.value,
          { role: 'assistant', text: reply.text, kind: reply.kind, sources: reply.sources, sig: reply.sig }]);
        this.afterRender(() => this.scrollToEnd());
      },
      error: err => {
        this.sending = false;
        if (this.droppedMeanwhile()) return;
        const text = err?.error?.message || `${this.name} is not available right now. Please try again in a few minutes.`;
        this.svc.messages$.next([...this.svc.messages$.value, { role: 'assistant', text, kind: 'error', retry: question }]);
        this.afterRender(() => this.scrollToEnd());
      }
    });
  }

  /**
   * The AI was taken away, or the person signed out, while a question was
   * being answered: the late reply (or the refusal) joins no conversation.
   */
  private droppedMeanwhile(): boolean {
    if (this.status) return false;
    this.cdr.markForCheck();
    return true;
  }

  /** A reply's paragraphs and lists, worked out once per message. */
  private readonly laidOut = new WeakMap<AssistantMessage, AssistantBlock[]>();
  blocksOf(m: AssistantMessage): AssistantBlock[] {
    let b = this.laidOut.get(m);
    if (!b) { b = m.role === 'user' ? [{ p: m.text }] : toBlocks(m.text); this.laidOut.set(m, b); }
    return b;
  }

  /** Quiet replies — a refusal, no records, a limit, the app's own note — are set apart from answers. */
  isQuiet(m: AssistantMessage): boolean {
    return ['out_of_scope', 'restricted', 'not_found', 'limit', 'note'].includes(m.kind || '');
  }

  iconFor(question: string): string { return ICONS.find(([re]) => re.test(question))?.[1] || 'chat_bubble_outline'; }

  /** "38 of 50 left today" */
  allowanceText(): string { const a = this.allowance; return a ? `${a.remaining} of ${a.limit} left today` : ''; }

  /** The report the answer came from, on its own page, with the same filters. */
  view(s: AssistantSource): void {
    if (s.view && s.view.startsWith('/') && !s.view.startsWith('//')) this.router.navigateByUrl(s.view);
  }

  /** The report file — or, when it is large, the message that it is being emailed. */
  download(s: AssistantSource): void {
    const d = s.download;
    if (!d || !DOWNLOADS.test(d.path) || this.downloading) return;
    let params = new HttpParams();
    for (const [k, v] of Object.entries(d.params)) if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    this.downloading = s;
    this.cdr.markForCheck();
    this.http.get(`${environment.apiUrl}${d.path}`, { params, observe: 'response', responseType: 'blob' })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: async res => {
          const note = await saveOrMessage(res, d.filename);
          this.downloading = null;
          if (note) this.svc.messages$.next([...this.svc.messages$.value, { role: 'assistant', text: note, kind: 'note' }]);
          this.cdr.markForCheck();
        },
        error: async err => {
          const text = await downloadError(err, 'The report could not be downloaded. Try again.');
          this.downloading = null;
          this.svc.messages$.next([...this.svc.messages$.value, { role: 'assistant', text, kind: 'error' }]);
          this.cdr.markForCheck();
        }
      });
  }

  /** "Production report · 15 – 21 Oct 2026 · VMC - 12 - F · All shifts" */
  sourceLine(s: { report?: string; title?: string; period?: { from: string; to: string } | null; from?: string | null; to?: string | null;
                  filters?: { machine?: string | null; shift?: string | null }; machine?: string | null; shift?: string | null }): string {
    const from = s.period?.from ?? s.from, to = s.period?.to ?? s.to;
    const machine = s.filters ? s.filters.machine : s.machine, shift = s.filters ? s.filters.shift : s.shift;
    const parts = [s.title || s.report];
    if (from && to) parts.push(from === to ? dayText(from) : `${dayText(from)} – ${dayText(to)}`);
    // undated pages (company details, machines now, maintenance, Program Transfer) name a machine only when one was asked about
    if (from && to) parts.push(machine || 'All machines', shift || 'All shifts');
    else if (machine) parts.push(machine);
    return parts.filter(Boolean).join(' · ');
  }

  limitText(): string {
    return `You’ve reached today’s ${this.name} allowance. Your allowance resets at ${this.allowance?.resets_text}. You can still access your reports.`;
  }

  private scrollToEnd(): void {
    const el = this.log?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  private afterRender(fn: () => void): void {
    afterNextRender(fn, { injector: this.injector });
  }
}
