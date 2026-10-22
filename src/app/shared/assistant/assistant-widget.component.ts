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

/*
 * The report assistant in the corner of every signed-in page, for people
 * with report access ("STM Mexa AI" — the server names it). A click opens
 * the chat over the page without leaving it. The launcher greets once per
 * session with one soft glow — no bouncing, no chat opening by itself, and
 * no motion at all for anyone who asked for less.
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
   * launcher still shows for report users, and the chat says it is not on
   * yet instead of the button being missing with no reason (22 Oct 2026).
   */
  unavailable = false;

  get name(): string { return this.status?.name || 'STM Mexa AI'; }
  /** For report users: on, or not set up yet. Hidden when the company admin switched it off, or for S&T. */
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
    this.load();
  }

  /** Only for people with report access, and only when the server says it is on. */
  private load(): void {
    this.unavailable = false;
    const mayUse = this.auth.isLoggedIn() && !this.auth.isSntSuper()
      && (this.auth.hasPermission('page:reports') || this.auth.hasPermission('page:oee-reports'));
    if (!mayUse) return;
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

  send(text: string = this.draft): void {
    const question = text.trim().slice(0, 500);
    if (!question || this.sending || this.closed) return;
    this.draft = '';
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
        if (reply.allowance && this.status) this.svc.status$.next({ ...this.status, allowance: reply.allowance });
        this.svc.messages$.next([...this.svc.messages$.value, { role: 'assistant', text: reply.text, kind: reply.kind, sources: reply.sources }]);
        this.afterRender(() => this.scrollToEnd());
      },
      error: err => {
        this.sending = false;
        const text = err?.error?.message || `${this.name} is not available right now. Please try again in a few minutes.`;
        this.svc.messages$.next([...this.svc.messages$.value, { role: 'assistant', text, kind: 'error', retry: question }]);
        this.afterRender(() => this.scrollToEnd());
      }
    });
  }

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
    if (s.report !== 'Company details') parts.push(machine || 'All machines', shift || 'All shifts');
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
