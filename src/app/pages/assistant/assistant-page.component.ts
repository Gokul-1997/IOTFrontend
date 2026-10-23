import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AssistantService } from '../../core/services/assistant.service';
import { AuthService } from '../../core/services/auth.service';
import { AssistantChatComponent } from '../../shared/assistant/assistant-chat.component';

/*
 * STM Mexa AI on a page of its own (/assistant — 23 Oct 2026, the user: "a
 * full-page chatbot; one icon for full view"). The same conversation as the
 * corner chat, with room to read. Opened from the corner's full-view button
 * it remembers that page, and the report filters it showed still go with
 * questions here; Small view goes back there with the corner chat open.
 */
@Component({
  selector: 'app-assistant-page',
  standalone: true,
  imports: [CommonModule, AssistantChatComponent],
  templateUrl: './assistant-page.component.html',
  styleUrl: './assistant-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AssistantPageComponent implements OnInit, OnDestroy {
  private readonly svc = inject(AssistantService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  name = 'STM Mexa AI';
  asked = false;
  /** The page the full view was opened from. */
  private from: string | null = null;

  ngOnInit(): void {
    const opened = this.svc.openedFrom;
    this.svc.openedFrom = null;
    if (opened && !/^\/assistant(?:[?#]|$)/.test(opened.url)) {
      this.from = opened.url;
      if (opened.context) this.svc.setContext(opened.context);
    }
    this.svc.status$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(s => { this.name = s?.name || 'STM Mexa AI'; this.cdr.markForCheck(); });
    this.svc.messages$.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(m => { this.asked = m.some(x => x.role === 'user'); this.cdr.markForCheck(); });
    // S&T or the company admin took the AI away while this page is open: off it
    this.auth.grantsChanged$.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { if (!this.svc.mayUse()) this.router.navigateByUrl(this.auth.getFirstAccessibleRoute()); });
  }

  // the report filters were that page's: they do not follow anywhere else
  ngOnDestroy(): void { this.svc.setContext(null); }

  newChat(): void { this.svc.newChat(); }

  /** Back to the page the full view was opened from (or the first page), with the conversation in the corner. */
  smallView(): void {
    this.router.navigateByUrl(this.from || this.auth.getFirstAccessibleRoute())
      .then(done => { if (done) this.svc.panelRequests$.next(); });
  }
}
