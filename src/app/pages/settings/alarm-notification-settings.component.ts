import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AlarmService, CriticalAlarmPolicy } from '../../core/services/alarm.service';
import { NotificationService } from '../../core/services/notification.service';

/** Critical-only delivery: one company switch and each person's inbox preference. */
@Component({
  selector: 'app-alarm-notification-settings', standalone: true, imports: [CommonModule],
  templateUrl: './alarm-notification-settings.component.html',
  styles: [`
    :host { display: block; min-width: 0; }
    .alarm-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .alarm-row > div { min-width: 0; } .mexa-switch { flex: none; }
    .alarm-status, .alarm-hint { font-size: .8rem; color: var(--mexa-ink-2); line-height: 1.55; margin: .65rem 0 0; }
    .alarm-error { color: var(--mexa-bad); font-size: .85rem; margin: .75rem 0; }
    .alarm-company { padding-top: 1rem; margin-top: 1rem; border-top: 1px solid var(--mexa-rule); }
    .alarm-scope { display: inline-flex; align-items: center; gap: .4rem; background: var(--mexa-row-alt); color: var(--mexa-ink-2);
      border-radius: 6px; font-size: .75rem; padding: .4rem .55rem; margin-bottom: .8rem; }
    .alarm-scope .material-icons { color: #dc2626; font-size: 1rem; }
    .alarm-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-top: .9rem; }
    .alarm-actions p { margin: 0; } @media (max-width: 420px) { .alarm-actions > button { width: 100%; } }
  `]
})
export class AlarmNotificationSettingsComponent implements OnInit, OnDestroy {
  readonly companyAdmin: boolean;
  receive = false;
  preferenceLoading = true;
  preferenceSaving = false;
  preferenceError = '';
  preferenceStatus = '';
  policy: CriticalAlarmPolicy | null = null;
  companyEnabled = false;
  companyLoading = false;
  companySaving = false;
  companyError = '';
  companyStatus = '';
  companyConflict = false;
  private readonly destroyed$ = new Subject<void>();

  constructor(private alarms: AlarmService, private notifications: NotificationService,
              auth: AuthService, private cdr: ChangeDetectorRef) {
    this.companyAdmin = auth.isCompanyAdmin() && !auth.isSntSuper();
  }

  ngOnInit(): void { this.loadPreference(); if (this.companyAdmin) this.loadCompany(); }
  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }

  loadPreference(): void {
    this.preferenceLoading = true;
    this.preferenceError = '';
    this.notifications.getAlarmPreference().pipe(takeUntil(this.destroyed$)).subscribe({
      next: res => {
        this.receive = res.data?.notify_alarm !== false;
        this.preferenceLoading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.preferenceLoading = false;
        this.preferenceError = err?.error?.message || 'Could not load your alarm notification preference.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleReceive(): void {
    if (this.preferenceLoading || this.preferenceSaving || this.preferenceError) return;
    const previous = this.receive;
    this.receive = !previous;
    this.preferenceSaving = true;
    this.preferenceStatus = '';
    this.notifications.updateAlarmPreference(this.receive).pipe(takeUntil(this.destroyed$)).subscribe({
      next: res => {
        this.receive = res.data?.notify_alarm !== false;
        this.preferenceSaving = false;
        this.preferenceStatus = 'Saved';
        this.cdr.markForCheck();
      },
      error: err => {
        this.receive = previous;
        this.preferenceSaving = false;
        this.preferenceError = err?.error?.message || 'Could not save your alarm notification preference.';
        this.cdr.markForCheck();
      }
    });
  }

  get companyChanged(): boolean { return !!this.policy && this.companyEnabled !== this.policy.enabled; }
  get showInboxHint(): boolean {
    return this.companyEnabled && !this.receive && !this.preferenceLoading && !this.preferenceError;
  }

  loadCompany(): void {
    if (!this.companyAdmin || this.companySaving) return;
    this.companyLoading = true;
    this.companyError = '';
    this.alarms.getNotificationPolicy().pipe(takeUntil(this.destroyed$)).subscribe({
      next: res => {
        this.policy = res.data;
        this.companyEnabled = res.data.enabled;
        this.companyLoading = false;
        this.companyConflict = false;
        this.companyStatus = '';
        this.cdr.markForCheck();
      },
      error: err => {
        this.companyLoading = false;
        this.companyError = err?.error?.message || 'Could not load company critical alarm alerts.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleCompany(): void {
    if (!this.policy || this.companyLoading || this.companySaving || this.companyConflict) return;
    this.companyEnabled = !this.companyEnabled;
    this.companyStatus = '';
    this.companyError = '';
  }

  saveCompany(): void {
    if (!this.companyAdmin || !this.policy || this.companyLoading || this.companySaving || this.companyConflict || !this.companyChanged) return;
    this.companySaving = true;
    this.companyError = '';
    this.companyStatus = '';
    this.alarms.updateNotificationPolicy(this.companyEnabled, this.policy.version).pipe(takeUntil(this.destroyed$)).subscribe({
      next: res => {
        this.policy = res.data;
        this.companyEnabled = res.data.enabled;
        this.companySaving = false;
        this.companyStatus = res.data.enabled ? 'Critical alarm alerts enabled for all company machines.' : 'Company critical alarm alerts turned off.';
        this.cdr.markForCheck();
      },
      error: err => {
        this.companySaving = false;
        this.companyConflict = err?.status === 409;
        this.companyError = this.companyConflict ? 'Another admin changed this setting. Reload before saving again.'
          : err?.error?.message || 'Could not save this setting. Your change is ready to retry.';
        this.cdr.markForCheck();
      }
    });
  }
}
