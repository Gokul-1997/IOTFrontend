import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, catchError, of } from 'rxjs';
import { EnergyDashboardService } from '../energy-dashboard/energy-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Tariff & Limits — the cost of a kWh and the overload threshold, company-wide
 * or per machine.
 *
 * Configuration, not a dashboard: it sat at the bottom of the Energy
 * Dashboard, below the machine table, behind a button only some roles could
 * see. It is its own page under Master now, opened by the Energy
 * "Tariff Settings" permission (page:analytics-energy:settings) — the same
 * permission the API checks before saving.
 */
@Component({
  selector: 'app-energy-tariff',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
  <form class="mexa-titlebar" (ngSubmit)="save()">
    <h1 class="mexa-title">Tariff &amp; Limits</h1>
    <span class="mexa-titlebar-spacer"></span>
    <a routerLink="/energy-dashboard" class="mexa-submit">Energy Dashboard</a>
  </form>

  <section class="mexa-card" aria-labelledby="tfFormTitle">
    <h2 id="tfFormTitle" class="mexa-card-title mexa-card-title-left">{{ editing ? 'Edit' : 'Set' }} a tariff</h2>
    <p class="mexa-card-hint">
      Leave the machine as <strong>Company default</strong> to price every machine; a row for one machine overrides it.
      Cost appears on the Energy and Factory dashboards once a price is set.
    </p>

    <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end mt-4" (ngSubmit)="save()" novalidate>
      <div>
        <label for="tfMachine" class="ui-label">Machine</label>
        <select id="tfMachine" class="ui-input" [(ngModel)]="form.machine_id" name="tfMachine">
          <option [ngValue]="null">Company default</option>
          <option *ngFor="let m of machines" [ngValue]="m.id">{{ m.machine_serial_no }}</option>
        </select>
      </div>
      <div>
        <label for="tfCost" class="ui-label">Cost per kWh</label>
        <input id="tfCost" type="number" min="0" step="0.01" class="ui-input" [(ngModel)]="form.cost_per_kwh" name="tfCost"
               [attr.aria-invalid]="costError ? true : null" aria-describedby="tfError">
      </div>
      <div>
        <label for="tfCurrency" class="ui-label">Currency</label>
        <input id="tfCurrency" type="text" maxlength="8" class="ui-input" [(ngModel)]="form.currency" name="tfCurrency">
      </div>
      <div>
        <label for="tfOverload" class="ui-label">Overload above (kW)</label>
        <input id="tfOverload" type="number" min="0" step="0.1" class="ui-input" [(ngModel)]="form.overload_kw" name="tfOverload"
               [attr.aria-invalid]="overloadError ? true : null" aria-describedby="tfError">
      </div>
      <div class="flex gap-2">
        <button type="submit" class="ui-btn ui-btn-primary" [disabled]="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <button *ngIf="editing" type="button" class="ui-btn ui-btn-ghost" (click)="reset()">Cancel</button>
      </div>
    </form>
    <p id="tfError" class="text-sm text-red-700 dark:text-red-400 mt-2" role="alert" *ngIf="error">{{ error }}</p>
  </section>

  <section class="mexa-card" aria-labelledby="tfListTitle">
    <h2 id="tfListTitle" class="mexa-card-title mexa-card-title-left">Configured</h2>
    <div class="mexa-tablewrap" tabindex="0" role="region" aria-label="Configured tariffs">
      <table class="mexa-table">
        <caption class="sr-only">Configured energy tariffs and limits</caption>
        <thead>
          <tr><th scope="col">Scope</th><th scope="col">Cost per kWh</th><th scope="col">Currency</th>
              <th scope="col">Overload Above</th><th scope="col"><span class="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          <tr *ngIf="loading"><td colspan="5" class="mexa-empty">Loading…</td></tr>
          <tr *ngFor="let s of settings">
            <td class="strong">{{ s.machine_serial_no || 'Company default' }}</td>
            <td class="num">{{ s.cost_per_kwh ?? '--' }}</td>
            <td>{{ s.currency }}</td>
            <td class="num">{{ s.overload_kw ? s.overload_kw + ' kW' : '--' }}</td>
            <td><button type="button" class="mexa-pagebtn" (click)="edit(s)"
                        [attr.aria-label]="'Edit ' + (s.machine_serial_no || 'company default')">Edit</button></td>
          </tr>
          <tr *ngIf="!loading && !settings.length">
            <td colspan="5" class="mexa-empty">No tariff set yet. Energy shows in kWh until one is.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  `
})
export class EnergyTariffComponent implements OnInit, OnDestroy {
  machines: any[] = [];
  settings: any[] = [];
  form: any = this.blank();
  editing = false;
  loading = false;
  saving = false;
  error = '';
  costError = false;
  overloadError = false;
  private destroy$ = new Subject<void>();

  constructor(private svc: EnergyDashboardService, private toast: ToastService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.svc.getMeta().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });
    this.load();
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private blank() { return { machine_id: null, cost_per_kwh: null, currency: 'INR', overload_kw: null }; }

  load(): void {
    this.loading = true; this.cdr.markForCheck();
    this.svc.getSettings().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.loading = false; this.settings = res?.data ?? []; this.cdr.markForCheck(); });
  }

  edit(s: any): void {
    this.form = { machine_id: s.machine_id ?? null, cost_per_kwh: s.cost_per_kwh, currency: s.currency || 'INR', overload_kw: s.overload_kw };
    this.editing = true; this.error = '';
    this.cdr.markForCheck();
    document.getElementById('tfCost')?.focus();
  }

  reset(): void { this.form = this.blank(); this.editing = false; this.error = ''; this.costError = this.overloadError = false; }

  /** Said before sending: a price or a limit, neither negative. */
  private validate(): boolean {
    const cost = this.form.cost_per_kwh, over = this.form.overload_kw;
    this.costError = cost !== null && cost !== '' && Number(cost) < 0;
    this.overloadError = over !== null && over !== '' && Number(over) < 0;
    if ((cost === null || cost === '') && (over === null || over === '')) {
      this.error = 'Enter a cost per kWh, an overload limit, or both.';
      this.costError = true;
      return false;
    }
    if (this.costError || this.overloadError) { this.error = 'Cost and overload limit cannot be negative.'; return false; }
    this.error = '';
    return true;
  }

  save(): void {
    if (!this.validate()) { this.cdr.markForCheck(); return; }
    this.saving = true; this.cdr.markForCheck();
    this.svc.saveSettings(this.form).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success('Tariff saved');
        this.reset();
        this.load();
      },
      error: err => {
        this.saving = false;
        this.error = err?.error?.message || 'Could not save the tariff. Try again.';
        this.cdr.markForCheck();
      }
    });
  }
}
