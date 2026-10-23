import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, Injector, OnInit, ViewChild,
         afterNextRender, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AssistantService, AssistantStatus } from '../../core/services/assistant.service';
import { AuthService } from '../../core/services/auth.service';
import { AssistantChatComponent } from './assistant-chat.component';

const WELCOMED = 'mexa-assistant-welcomed';
/** The full page — the corner button steps aside there. */
const FULL_PAGE = /^\/assistant(?:[?#]|$)/;

/*
 * The company assistant in the corner of every signed-in page ("STM Mexa
 * AI" — the server names it): for a company S&T gave it to, and the roles
 * its admin gave it to (23 Oct 2026); what it can answer follows the
 * person's role. A click opens the chat over the page without leaving it;
 * its full-view button opens the same conversation on a page of its own
 * (/assistant), and Small view there comes back here.
 * The launcher greets once per session with one soft glow — no bouncing, no
 * chat opening by itself, and no motion at all for anyone who asked for less.
 */
@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [CommonModule, AssistantChatComponent],
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
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('launcher') launcher?: ElementRef<HTMLButtonElement>;

  status: AssistantStatus | null = null;
  open = false;
  /** The launcher's one greeting this session. */
  greet = false;
  /**
   * The server has no assistant yet (no AI key, or not deployed): the
   * launcher still shows, and the chat says it is not on yet instead of the
   * button being missing with no reason (22 Oct 2026).
   */
  unavailable = false;
  /** On the full page: the conversation is the page itself. */
  onFullPage = false;

  get name(): string { return this.status?.name || 'STM Mexa AI'; }
  /** For everyone in a company: on, or not set up yet. Hidden when S&T switched it off for the company, or for S&T. */
  get visible(): boolean { return !this.onFullPage && (!!this.status?.enabled || this.unavailable); }

  ngOnInit(): void {
    this.svc.status$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(s => { this.status = s; this.cdr.markForCheck(); });
    this.svc.unavailable$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(u => { this.unavailable = u; this.cdr.markForCheck(); });
    this.auth.sessionChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.open = false; this.load(); });
    // S&T gave or took the AI, or the company admin changed this person's role,
    // while they are signed in: the button follows without signing in again
    this.auth.grantsChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.recheck());
    this.onFullPage = FULL_PAGE.test(this.router.url);
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(e => {
        this.onFullPage = FULL_PAGE.test(e.urlAfterRedirects);
        if (this.onFullPage) this.open = false;
        this.cdr.markForCheck();
      });
    // back from the full page, or a report opened from it: the conversation goes on here
    this.svc.panelRequests$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { if (this.visible) this.openPanel(); });
    this.load();
  }

  /** For someone who may use it: whether the server has it on. */
  private load(): void {
    this.svc.unavailable$.next(false);
    if (!this.svc.mayUse()) return;
    this.svc.loadStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.svc.unavailable$.next(!s.enabled && s.reason === 'NOT_CONFIGURED');
        if (s.enabled) {
          try { this.greet = !sessionStorage.getItem(WELCOMED); sessionStorage.setItem(WELCOMED, '1'); } catch { this.greet = false; }
        }
        this.cdr.markForCheck();
      },
      // the server does not have the assistant yet (an older API): say so in the chat
      error: err => this.svc.unavailable$.next(err?.status === 404 || err?.status === 0 || err?.status >= 500)
    });
  }

  /** Given now: the button comes. Taken away: the button, the chat and its conversation go. */
  private recheck(): void {
    if (this.svc.mayUse()) {
      if (!this.status && !this.unavailable) this.load();
      return;
    }
    this.open = false;
    this.svc.unavailable$.next(false);
    this.svc.messages$.next([]);
    this.svc.status$.next(null);
    this.cdr.markForCheck();
  }

  openPanel(): void {
    this.open = true;
    this.greet = false;
    this.cdr.markForCheck();
  }

  close(): void {
    this.open = false;
    this.cdr.markForCheck();
    this.afterRender(() => this.launcher?.nativeElement.focus());
  }

  /** Full view: this conversation on a page of its own, which remembers the way back and this page's report filters. */
  expand(): void {
    this.svc.openedFrom = { url: this.router.url, context: this.svc.context$.value };
    this.open = false;
    this.cdr.markForCheck();
    this.router.navigateByUrl('/assistant');
  }

  private afterRender(fn: () => void): void {
    afterNextRender(fn, { injector: this.injector });
  }
}
