import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, EventEmitter, Injector, Input, OnInit, Output,
         ViewChild, afterNextRender, inject } from '@angular/core';
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
 * The conversation with the company assistant ("Mexa AI"), as one card
 * in two places (23 Oct 2026, the user: "a full-page chatbot — one icon for
 * full view"): "panel", over the page from the corner button, with its own
 * header (new chat, full view, close); and "page", the full page
 * (/assistant), whose title bar holds the actions. Both show the one
 * conversation the service keeps — a reply joins whichever is open.
 */
@Component({
  selector: 'app-assistant-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assistant-chat.component.html',
  styleUrl: './assistant-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-page]': 'variant === "page"' }
})
export class AssistantChatComponent implements OnInit {
  private readonly svc = inject(AssistantService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  @Input() variant: 'panel' | 'page' = 'panel';
  /** The panel's close button. */
  @Output() readonly dismiss = new EventEmitter<void>();
  /** The panel's full-view button. */
  @Output() readonly expand = new EventEmitter<void>();

  @ViewChild('input') input?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('log') log?: ElementRef<HTMLElement>;

  status: AssistantStatus | null = null;
  messages: AssistantMessage[] = [];
  context: AssistantContext | null = null;
  sending = false;
  unavailable = false;
  draft = '';
  downloading: AssistantSource | null = null;

  get name(): string { return this.status?.name || 'Mexa AI'; }
  /** "How can I help, Ravi?" */
  get greeting(): string {
    const who = String(this.auth.getUser()?.username || '').trim().split(/\s+/)[0];
    return who ? `How can I help, ${who}?` : 'How can I help?';
  }
  get allowance() { return this.status?.allowance; }
  get limitReached(): boolean { return !!this.allowance && this.allowance.remaining <= 0; }
  /** S&T switched it off for the company: the corner button goes, and the full page says why. */
  get switchedOff(): boolean { return !!this.status && !this.status.enabled && !this.unavailable; }
  get closed(): boolean { return this.svc.closed; }
  get asked(): boolean { return this.messages.some(m => m.role === 'user'); }
  get suggestions(): string[] { return this.status?.suggestions || []; }

  ngOnInit(): void {
    this.svc.messages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(m => { this.messages = m; this.newest(); });
    this.svc.sending$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(s => { this.sending = s; this.newest(); });
    this.svc.context$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(c => { this.context = c; this.cdr.markForCheck(); });
    this.svc.status$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(s => { this.status = s; this.cdr.markForCheck(); });
    this.svc.unavailable$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(u => { this.unavailable = u; this.cdr.markForCheck(); });
    this.afterRender(() => { this.input?.nativeElement.focus(); this.scrollToEnd(); });
  }

  /** A new line in the conversation, or an answer under way: the newest stays in sight. */
  private newest(): void {
    this.cdr.markForCheck();
    this.afterRender(() => this.scrollToEnd());
  }

  newChat(): void {
    this.svc.newChat();
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
    if (!this.svc.send(text)) return;
    this.draft = '';
    this.afterRender(() => this.grow());
  }

  /** The same question again, after a failure. */
  retry(failed: AssistantMessage): void { this.svc.retry(failed); }

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

  /** The report the answer came from, on its own page, with the same filters — from the full page, with the chat beside it. */
  view(s: AssistantSource): void {
    if (!s.view || !s.view.startsWith('/') || s.view.startsWith('//')) return;
    this.router.navigateByUrl(s.view).then(done => { if (done && this.variant === 'page') this.svc.panelRequests$.next(); });
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
