import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';

interface PrefRow { key: string; label: string; hint: string; pages?: string[]; }

/**
 * Application settings: theme, per-user notification preferences, and — for
 * a company admin — the way to Users and Roles & Permissions.
 *
 * Notification preferences are distinct from the company-wide
 * alert_preferences (whether an alarm/offline/low-OEE event creates a
 * notification at all, set by an admin). This is one person deciding which
 * of the notifications that do exist they want surfaced to them.
 *
 * Since 6 Oct 2026 the light/dark switch lives only here (the header's
 * button was removed), and so does a company admin's Admin (it was in the
 * header bar). S&T opens Settings for light/dark alone: it belongs to no
 * company and is sent no notifications.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings.component.html',
  styles: [`
    .set-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); align-items: start; }
    .set-grid .mexa-card + .mexa-card { margin-top: 0; }
    .set-hint { margin: -.4rem 0 .5rem; }
    .set-text { min-width: 0; }
    .set-ok { font-size: .8rem; color: #ffffff; }
    :host-context(.dark) .set-ok { color: #6fdba0; }
    .set-retry { background: none; border: 0; padding: 0; font: inherit; text-decoration: underline; color: inherit; cursor: pointer; }
    /* a page to go to, laid out as a setting row: icon, what it is, a chevron */
    .set-link { color: inherit; text-decoration: none; border-radius: 10px; margin: 0 -.5rem; padding: .6rem .5rem;
                transition: background-color .2s ease; }
    .set-link:hover { background: var(--mexa-row-alt); }
    .set-link:focus-visible { outline: 2px solid #3a4ab8; outline-offset: 2px; }
    .set-link-icon { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 10px; display: grid; place-items: center;
                     background: var(--mexa-row-alt); color: #3a4ab8; font-size: 1.25rem; }
    :host-context(.dark) .set-link-icon { color: #b9b6ff; }
    .set-link .set-text { flex: 1; }
    .set-chevron { flex: none; color: var(--mexa-ink-3); }
    @media (prefers-reduced-motion: reduce) { .set-link { transition: none; } }
  `]
})
export class SettingsComponent implements OnInit {

  readonly rows: PrefRow[] = [
    { key: 'notify_alarm',             label: 'Alarms',            hint: 'A machine goes into alarm',
      pages: ['page:alarms', 'page:analytics-alarms', 'page:dashboard'] },
    { key: 'notify_maintenance',       label: 'Maintenance',       hint: 'A ticket or scheduled service is due',
      pages: ['page:maintenance', 'page:analytics-maintenance', 'page:analytics-preventive', 'page:analytics-periodic', 'page:maintenance-report'] },
    { key: 'notify_ticket',            label: 'Tickets',           hint: 'A ticket you are involved in changes status',
      pages: ['page:maintenance'] },
    { key: 'notify_program_transfer',  label: 'Program transfer',  hint: 'A transfer needs your approval, or completes',
      pages: ['page:programs'] },
    { key: 'notify_system',            label: 'System',            hint: 'Account and platform announcements' }
  ];

  /* Only the notifications this person's role can receive. Every role saw
     all five — HR could switch Program transfer alerts on and off although
     nothing ever sent one to HR. The API sends alarms only to the same roles. */
  get visibleRows(): PrefRow[] {
    return this.rows.filter(r => !r.pages || r.pages.some(p => this.auth.hasPermission(p)));
  }

  /** S&T: light/dark only. A company admin: also Users and Roles. */
  readonly isSntSuper: boolean;
  readonly companyAdmin: boolean;

  prefs: Record<string, boolean> = {};
  loading = true;
  errorMsg = '';
  saving = false;
  saveNote = '';
  saveErr = '';

  constructor(
    public theme: ThemeService,
    private auth: AuthService,
    private notif: NotificationService,
    private cdr: ChangeDetectorRef
  ) {
    this.isSntSuper = this.auth.isSntSuper();
    this.companyAdmin = this.auth.isAdmin() && !this.isSntSuper;
  }

  ngOnInit(): void {
    // S&T is sent no notifications, so there are no preferences to load
    if (this.isSntSuper) { this.loading = false; return; }
    this.load();
  }

  get subtitle(): string {
    if (this.isSntSuper) return 'Appearance';
    return this.companyAdmin ? 'Appearance, notifications and administration' : 'Appearance and notifications';
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    this.notif.getPreferences().subscribe({
      next: (res: any) => {
        this.prefs = res.data || {};
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMsg = err?.error?.message || 'Unable to load your preferences.';
        this.cdr.markForCheck();
      }
    });
  }

  toggle(key: string): void {
    this.prefs = { ...this.prefs, [key]: !this.prefs[key] };
    this.save();
  }

  /* An "Email digest" switch sat here. Nothing ever sent a digest, so it saved
     a choice that did nothing; it comes back with the digest itself, next
     phase. */

  /** Saves on every change — a settings toggle, not a form with a submit
   *  step, so there is nothing for the user to remember to click. */
  private save(): void {
    this.saving = true;
    this.saveErr = '';
    this.saveNote = '';
    this.cdr.markForCheck();

    this.notif.updatePreferences(this.prefs).subscribe({
      next: (res: any) => {
        this.saving = false;
        this.prefs = res.data || this.prefs;
        this.saveNote = 'Saved.';
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.saveErr = err?.error?.message || 'Could not save. Try again.';
        this.cdr.markForCheck();
      }
    });
  }
}
