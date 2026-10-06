import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, catchError, of, forkJoin } from 'rxjs';
import { EnergyDashboardService } from '../energy-dashboard/energy-dashboard.service';
import { MachinesService } from '../machines/machines.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

/** One machine's row in the hour-rate table: what is saved, and what is typed. */
interface RateRow { id: number; name: string; model: string | null; saved: number | null; value: number | null; }

const toRate = (v: any): number | null =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * Tariff & Rates — every cost the platform prices with, on one page:
 *
 *   - the electricity tariff: ₹ per unit (kWh), company-wide or per machine,
 *     and the overload threshold;
 *   - each machine's hour rate: ₹ per hour, which prices idle and alarm time
 *     on the Downtime and OEE screens (machines.hour_rate).
 *
 * One page because two ("Energy Tariff" here, the hour rate on each machine's
 * form) left people unsure where a rate goes (6 Oct 2026). The machine form
 * still shows the same hour rate.
 *
 * Opened by the Energy "Tariff Settings" permission
 * (page:analytics-energy:settings), the one the API checks before saving a
 * tariff. Hour rates are machine data: the table shows to whoever can view
 * machines and saves through the machines API, for whoever can edit them.
 */
@Component({
  selector: 'app-energy-tariff',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
  <form class="mexa-titlebar" (ngSubmit)="save()">
    <h1 class="mexa-title">Tariff &amp; Rates</h1>
    <span class="mexa-titlebar-spacer"></span>
    <a routerLink="/energy-dashboard" class="mexa-submit flex items-center gap-2">Go to Energy Dashboard <span class="ui-tab-icon material-icons" aria-hidden="true">east</span></a>
  </form>

  <section class="mexa-card p-4" aria-labelledby="tfFormTitle">
    <h2 id="tfFormTitle" class="mexa-card-title mexa-card-title-left mt-2">{{ editing ? 'Edit' : 'Set' }} the electricity tariff — ₹ per unit (kWh)</h2>
    <p class="mexa-card-hint">
      The EB rate. Leave the machine as <strong>Company default</strong> to price every machine; a row for one machine overrides it.
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
        <button type="submit" class="ui-btn ui-btn-primary" [disabled]="saving">
        <span class="ui-tab-icon material-icons" aria-hidden="true">save</span>
        {{ saving ? 'Saving…' : 'Save' }}</button>
        <button *ngIf="editing" type="button" class="ui-btn ui-btn-ghost" (click)="reset()">Cancel</button>
      </div>
    </form>
    <p id="tfError" class="text-sm text-red-700 dark:text-red-400 mt-2" role="alert" *ngIf="error">{{ error }}</p>
  </section>

  <section class="mexa-card mt-3 p-4" aria-labelledby="tfListTitle">
    <h2 id="tfListTitle" class="mexa-card-title mexa-card-title-left mb-2">Electricity tariffs set</h2>
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

  <!-- each machine's hour rate: the same value as on its machine form -->
  <section *ngIf="canViewRates" class="mexa-card mt-3 p-4" aria-labelledby="hrTitle">
    <h2 id="hrTitle" class="mexa-card-title mexa-card-title-left">Machine hour rate — ₹ per hour</h2>
    <p class="mexa-card-hint">
      What an hour of each machine costs. The Downtime and OEE screens price its idle and alarm time with it.
      Leave a machine blank if its rate is not known.
    </p>
    <div class="mexa-tablewrap mt-2" tabindex="0" role="region" aria-label="Machine hour rates">
      <table class="mexa-table">
        <caption class="sr-only">Hour rate of each machine, in rupees per hour</caption>
        <thead>
          <tr><th scope="col">Machine</th><th scope="col">Model</th><th scope="col">₹ per hour</th></tr>
        </thead>
        <tbody>
          <tr *ngIf="ratesLoading"><td colspan="3" class="mexa-empty">Loading…</td></tr>
          <tr *ngFor="let r of rates; trackBy: rateKey" [class.hr-changed]="isChanged(r)">
            <th scope="row" class="strong hr-name">{{ r.name }}</th>
            <td>{{ r.model || '--' }}</td>
            <td>
              <input type="number" min="0" max="1000000" step="0.01" inputmode="decimal" class="ui-input hr-input"
                     [(ngModel)]="r.value" [ngModelOptions]="{ standalone: true }" placeholder="--"
                     [disabled]="!canEditRates || ratesSaving"
                     [attr.aria-label]="'Hour rate of ' + r.name + ', rupees per hour'"
                     [attr.aria-invalid]="badRate(r.value) ? true : null">
            </td>
          </tr>
          <tr *ngIf="!ratesLoading && !rates.length"><td colspan="3" class="mexa-empty">No machines yet.</td></tr>
        </tbody>
      </table>
    </div>
    <div *ngIf="canEditRates" class="flex flex-wrap items-center gap-3 mt-3">
      <button type="button" class="ui-btn ui-btn-primary" (click)="saveRates()" [disabled]="ratesSaving || !changedRates.length">
        <span class="ui-tab-icon material-icons" aria-hidden="true">save</span>
        {{ ratesSaving ? 'Saving…' : 'Save hour rates' }}
      </button>
      <span class="mexa-setting-hint" *ngIf="changedRates.length && !ratesSaving">{{ changedRates.length }} changed, not saved yet</span>
    </div>
    <p *ngIf="ratesError" class="text-sm text-red-700 dark:text-red-400 mt-2" role="alert">{{ ratesError }}</p>
  </section>
  `,
  styles: [`
    .hr-name { text-align: left; }
    .hr-input { max-width: 9rem; text-align: right; font-variant-numeric: tabular-nums; }
    .hr-input[aria-invalid="true"] { border-color: #c32b3f; }
    /* a typed rate that is not saved yet */
    tr.hr-changed th, tr.hr-changed td { background: var(--mexa-row-alt); }
  `]
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

  /* ── machine hour rates ── */
  rates: RateRow[] = [];
  ratesLoading = false;
  ratesSaving = false;
  ratesError = '';
  readonly canEditRates: boolean;
  readonly canViewRates: boolean;

  constructor(private svc: EnergyDashboardService, private machinesSvc: MachinesService, auth: AuthService,
              private toast: ToastService, private cdr: ChangeDetectorRef) {
    this.canEditRates = auth.hasAction('machines', 'edit');
    this.canViewRates = this.canEditRates || auth.hasAction('machines', 'view');
  }

  ngOnInit(): void {
    this.svc.getMeta().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });
    this.load();
    if (this.canViewRates) this.loadRates();
  }

  /** Every machine with its rate, in the order the plant counts them (VMC - 2 before VMC - 10). */
  loadRates(): void {
    this.ratesLoading = true; this.cdr.markForCheck();
    this.machinesSvc.getMachines({ page: 1, limit: 500, sortBy: 'm.machine_serial_no', sortDir: 'asc' })
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => {
        this.ratesLoading = false;
        this.rates = (res?.data ?? [])
          .filter((m: any) => m.is_active !== false)
          .map((m: any) => ({ id: m.id, name: m.machine_serial_no, model: m.model ? String(m.model).trim() : null,
                              saved: toRate(m.hour_rate), value: toRate(m.hour_rate) }))
          .sort((a: RateRow, b: RateRow) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (!res) this.ratesError = 'Could not load the machines. Reload the page to try again.';
        this.cdr.markForCheck();
      });
  }

  rateKey(_: number, r: RateRow): number { return r.id; }

  /** A rate the API would refuse: below 0 or above 10,00,000. */
  badRate(v: number | null): boolean {
    return v !== null && v !== undefined && (Number(v) < 0 || Number(v) > 1000000);
  }

  isChanged(r: RateRow): boolean { return toRate(r.value) !== r.saved; }

  get changedRates(): RateRow[] { return this.rates.filter(r => this.isChanged(r)); }

  /** Saves only the machines whose rate changed, through the machines API (machine.update). */
  saveRates(): void {
    const changed = this.changedRates;
    if (!changed.length) return;
    if (changed.some(r => this.badRate(r.value))) {
      this.ratesError = 'An hour rate must be from 0 to 10,00,000 rupees.';
      this.cdr.markForCheck();
      return;
    }
    this.ratesSaving = true; this.ratesError = ''; this.cdr.markForCheck();
    forkJoin(changed.map(r => this.machinesSvc.update(r.id, { hour_rate: toRate(r.value) })))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          for (const r of changed) r.saved = toRate(r.value);
          this.ratesSaving = false;
          this.toast.success(changed.length === 1 ? 'Hour rate saved' : `${changed.length} hour rates saved`);
          this.cdr.markForCheck();
        },
        error: err => {
          this.ratesSaving = false;
          this.ratesError = err?.error?.message || 'Could not save the hour rates. Try again.';
          // some may have been saved: read back what is stored
          this.loadRates();
        }
      });
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
