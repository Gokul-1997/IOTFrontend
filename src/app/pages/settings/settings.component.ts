import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationService } from '../../core/services/notification.service';

interface PrefRow { key: string; label: string; hint: string; }

/**
 * Application settings: theme and per-user notification preferences.
 *
 * Distinct from the company-wide alert_preferences (whether an alarm/
 * offline/low-OEE event creates a notification at all, set by an admin).
 * This is one person deciding which of the notifications that do exist
 * they want surfaced to them.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html'
})
export class SettingsComponent implements OnInit {

  readonly rows: PrefRow[] = [
    { key: 'notify_alarm',             label: 'Alarms',            hint: 'A machine goes into alarm' },
    { key: 'notify_maintenance',       label: 'Maintenance',       hint: 'A ticket or scheduled service is due' },
    { key: 'notify_ticket',            label: 'Tickets',           hint: 'A ticket you are involved in changes status' },
    { key: 'notify_program_transfer',  label: 'Program transfer',  hint: 'A transfer needs your approval, or completes' },
    { key: 'notify_system',            label: 'System',            hint: 'Account and platform announcements' }
  ];

  prefs: Record<string, boolean> = {};
  loading = true;
  errorMsg = '';
  saving = false;
  saveNote = '';
  saveErr = '';

  constructor(
    public theme: ThemeService,
    private notif: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void { this.load(); }

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
