import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, takeUntil } from 'rxjs';
import { AlarmNotificationRule, AlarmService } from '../../core/services/alarm.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';

interface RuleRow extends AlarmNotificationRule {
  delay_seconds: number;
  preset: number | 'custom';
  customSeconds: number | null;
  savedEnabled: boolean;
  savedSeconds: number;
  saving: boolean;
  error: string;
  status: string;
}

const PRESETS = [30, 60, 300, 600];

/** Company machine rules run on the server; this page never polls telemetry. */
@Component({
  selector: 'app-alarm-notification-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alarm-notification-settings.component.html',
  styles: [`
    :host { display: block; min-width: 0; }
    .alarm-hint { color: var(--mexa-ink-2); font-size: .85rem; line-height: 1.55; margin: .5rem 0; }
    .alarm-personal { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 1rem; }
    .alarm-personal > div { min-width: 0; }
    .mexa-switch { flex: none; }
    .alarm-admin { margin-top: 1.25rem; border-top: 1px solid var(--mexa-rule); padding-top: 1rem; }
    .alarm-admin h3 { font-size: .95rem; font-weight: 600; margin: 0; }
    .alarm-search { display: block; margin: 1rem 0; }
    .alarm-list { list-style: none; margin: 0; padding: 0; }
    .alarm-row { padding: 1rem 0; border-top: 1px solid var(--mexa-rule); }
    .alarm-machine { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    .alarm-name { min-width: 0; overflow-wrap: anywhere; }
    .alarm-name strong { display: block; font-size: .9rem; color: var(--mexa-ink); }
    .alarm-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .65rem; margin-top: .75rem; }
    .alarm-field { flex: 1 1 10rem; min-width: 0; }
    .alarm-field label { display: block; margin-bottom: .3rem; }
    .alarm-field .ui-input { width: 100%; min-width: 0; }
    .alarm-status { margin: .5rem 0 0; font-size: .8rem; color: var(--mexa-ink-2); }
    .alarm-error { margin: .5rem 0; color: var(--mexa-bad); font-size: .85rem; }
    .alarm-pager { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; padding-top: .75rem; }
    .alarm-pager span { font-size: .8rem; color: var(--mexa-ink-2); }
    .alarm-pager > div { display: flex; gap: .5rem; }
    @media (max-width: 420px) { .alarm-controls > button { width: 100%; } .alarm-field { flex-basis: 100%; } }
  `]
})
export class AlarmNotificationSettingsComponent implements OnInit, OnDestroy {
  readonly companyAdmin: boolean;
  receive = false;
  preferenceLoading = true;
  preferenceSaving = false;
  preferenceError = '';
  preferenceStatus = '';
  rows: RuleRow[] = [];
  loading = false;
  listError = '';
  search = '';
  page = 1;
  total = 0;
  totalPages = 1;
  private readonly destroyed$ = new Subject<void>();
  private readonly searches$ = new Subject<void>();
  private listRequest?: Subscription;

  constructor(private alarms: AlarmService, private notifications: NotificationService,
              auth: AuthService, private cdr: ChangeDetectorRef) {
    this.companyAdmin = auth.isCompanyAdmin() && !auth.isSntSuper();
  }

  ngOnInit(): void {
    this.loadPreference();
    if (this.companyAdmin) {
      this.searches$.pipe(debounceTime(300), takeUntil(this.destroyed$)).subscribe(() => this.loadPage(1));
      this.loadPage(1);
    }
  }

  ngOnDestroy(): void {
    this.listRequest?.unsubscribe();
    this.destroyed$.next();
    this.destroyed$.complete();
    this.searches$.complete();
  }

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

  searchChanged(value: string): void {
    this.search = value.slice(0, 100);
    this.listRequest?.unsubscribe();
    this.page = 1;
    this.loading = true;
    this.listError = '';
    this.searches$.next();
  }

  loadPage(page: number): void {
    if (!this.companyAdmin) return;
    this.listRequest?.unsubscribe();
    this.page = page;
    this.loading = true;
    this.listError = '';
    this.listRequest = this.alarms.getNotificationRules(page, this.search.trim()).pipe(takeUntil(this.destroyed$)).subscribe({
      next: res => {
        this.rows = (res.data || []).map(rule => this.toRow(rule));
        this.page = res.pagination?.page || page;
        this.total = res.pagination?.total || 0;
        this.totalPages = Math.max(1, res.pagination?.totalPages || 1);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.listError = err?.error?.message || 'Could not load machine alarm rules.';
        this.cdr.markForCheck();
      }
    });
  }

  private toRow(rule: AlarmNotificationRule): RuleRow {
    const seconds = rule.delay_seconds ?? 600;
    return { ...rule, delay_seconds: seconds, preset: PRESETS.includes(seconds) ? seconds : 'custom',
      customSeconds: seconds, savedEnabled: rule.enabled, savedSeconds: seconds, saving: false, error: '', status: '' };
  }

  seconds(row: RuleRow): number | null { return row.preset === 'custom' ? row.customSeconds : row.preset; }

  invalid(row: RuleRow): boolean {
    const seconds = this.seconds(row);
    return seconds === null || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400;
  }

  changed(row: RuleRow): boolean { return row.enabled !== row.savedEnabled || this.seconds(row) !== row.savedSeconds; }

  edited(row: RuleRow): void { row.status = ''; row.error = ''; }

  save(row: RuleRow): void {
    if (row.saving || this.loading || !this.changed(row)) return;
    if (this.invalid(row)) {
      row.error = 'Enter whole seconds from 1 to 86,400.';
      return;
    }
    row.saving = true;
    row.error = '';
    row.status = '';
    this.alarms.updateNotificationRule(row.machine_id, { enabled: row.enabled, delay_seconds: this.seconds(row)! })
      .pipe(takeUntil(this.destroyed$)).subscribe({
        next: res => {
          Object.assign(row, this.toRow(res.data));
          row.status = 'Saved';
          this.cdr.markForCheck();
        },
        error: err => {
          row.saving = false;
          row.error = err?.error?.message || 'Could not save this machine rule. Try again.';
          this.cdr.markForCheck();
        }
      });
  }

  get savingRule(): boolean { return this.rows.some(row => row.saving); }
  trackMachine(_index: number, row: RuleRow): number { return row.machine_id; }
}
