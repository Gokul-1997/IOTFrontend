import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, catchError, of, forkJoin } from 'rxjs';
import { EnergyDashboardService } from '../energy-dashboard/energy-dashboard.service';
import { MachinesService } from '../machines/machines.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { qty } from '../../shared/format-number';
import { SearchSelectDirective } from '../../shared/search-select.directive';

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
  imports: [CommonModule, FormsModule, RouterModule, StateComponent, SkeletonRowsComponent, SearchSelectDirective],
  template: `
  <div class="mexa-titlebar">
  <div class="titlebar w-fit flex items-center gap-2 text-white">
  <span class="material-icons" aria-hidden="true">payments</span>
    <h1 class="mexa-title">Tariff &amp; Rates</h1>
    </div>
    <span class="mexa-titlebar-spacer"></span>
    <a routerLink="/energy-dashboard" class="mexa-submit flex items-center gap-2">Go to Energy Dashboard <span class="ui-tab-icon material-icons" aria-hidden="true">east</span></a>
  </div>

  <section class="mexa-card p-4" aria-labelledby="tfListTitle">
    <div class="tf-head">
      <div>
        <h2 id="tfListTitle" class="mexa-card-title mexa-card-title-left">Electricity tariff — ₹ per unit (kWh)</h2>
        <p class="mexa-card-hint">
          The EB rate. The <strong>Company default</strong> prices every machine; a row for one machine overrides it.
          Cost appears on the Energy and Factory dashboards once a price is set.
        </p>
      </div>
      <button type="button" class="ui-btn ui-btn-primary" (click)="openTariff()">
        <span class="ui-tab-icon material-icons" aria-hidden="true">add</span>Add tariff
      </button>
    </div>
    <div class="mexa-tablewrap mt-2" tabindex="0" role="region" aria-label="Configured tariffs">
      <table class="mexa-table">
        <caption class="sr-only">Configured energy tariffs and limits</caption>
        <thead>
          <tr><th scope="col">Scope</th><th scope="col" class="qty">Cost per kWh</th><th scope="col" class="col-md">Currency</th>
              <th scope="col" class="qty">Overload above</th><th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr>
        </thead>
        <tbody *ngIf="loading" appSkeletonRows [cols]="5" [rows]="3" label="Loading tariffs…"></tbody>
        <tbody *ngIf="!loading">
          <tr *ngFor="let s of settings">
            <td class="strong">{{ s.machine_serial_no || 'Company default' }}</td>
            <td class="num qty">{{ s.cost_per_kwh ?? '--' }}</td>
            <td class="col-md">{{ s.currency }}</td>
            <td class="num qty">{{ s.overload_kw ? s.overload_kw + ' kW' : '--' }}</td>
            <td class="actions"><button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" (click)="edit(s)"
                        [attr.aria-label]="'Edit tariff for ' + (s.machine_serial_no || 'company default')">
              <span class="material-icons" aria-hidden="true">edit</span>Edit</button></td>
          </tr>
          <tr *ngIf="!settings.length">
            <td colspan="5" class="mexa-empty">
              <app-state title="No tariff set yet" text="Energy shows in kWh until one is. Add one with “Add tariff”."></app-state>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- each machine's hour rate: the same value as on its machine form -->
  <section *ngIf="canViewRates" class="mexa-card mt-3 p-4" aria-labelledby="hrTitle">
    <div class="tf-head">
      <div>
        <h2 id="hrTitle" class="mexa-card-title mexa-card-title-left">Machine hour rate — ₹ per hour</h2>
        <p class="mexa-card-hint">
          What an hour of each machine costs. The Downtime and OEE screens price its idle and alarm time with it.
        </p>
      </div>
      <button *ngIf="canEditRates" type="button" class="ui-btn ui-btn-primary" (click)="openRates()"
              [disabled]="ratesLoading || !rates.length">
        <span class="ui-tab-icon material-icons" aria-hidden="true">edit</span>Edit hour rates
      </button>
    </div>
    <div class="mexa-tablewrap mt-2" tabindex="0" role="region" aria-label="Machine hour rates">
      <table class="mexa-table">
        <caption class="sr-only">Hour rate of each machine, in rupees per hour</caption>
        <thead>
          <tr><th scope="col">Machine</th><th scope="col" class="col-md">Model</th><th scope="col" class="qty">₹ per hour</th></tr>
        </thead>
        <tbody *ngIf="ratesLoading" appSkeletonRows [cols]="3" [rows]="4" label="Loading hour rates…"></tbody>
        <tbody *ngIf="!ratesLoading">
          <tr *ngFor="let r of rates; trackBy: rateKey">
            <th scope="row" class="strong hr-name">{{ r.name }}</th>
            <td class="col-md">{{ r.model || '--' }}</td>
            <td class="num qty">{{ qty(r.saved, 2) }}</td>
          </tr>
          <tr *ngIf="!rates.length"><td colspan="3" class="mexa-empty">
            <app-state icon="precision_manufacturing" title="No machines yet" text="Add machines first; their hour rates are set here."></app-state>
          </td></tr>
        </tbody>
      </table>
    </div>
    <p *ngIf="ratesError && !showRates" class="text-sm text-red-700 dark:text-red-400 mt-2" role="alert">{{ ratesError }}</p>
  </section>


  <!-- ══ the forms: the same dialog as every other page (they used to sit in the page) ══ -->

  <!-- ── ADD / EDIT TARIFF ── -->
  <div *ngIf="showTariff" class="ui-overlay">
    <div class="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="tfFormTitle">
      <div class="ui-dialog-header">
        <div>
          <h2 id="tfFormTitle" class="ui-dialog-title">{{ editing ? 'Edit tariff' : 'Add tariff' }}</h2>
          <p class="ui-dialog-subtitle">₹ per unit (kWh). The company default prices every machine; a machine's own tariff overrides it.</p>
        </div>
        <button type="button" class="ui-close" (click)="closeTariff()" aria-label="Close without saving">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form (ngSubmit)="save()" class="contents" novalidate>
        <div class="ui-dialog-body">
          <div id="tfError" *ngIf="error" class="ui-alert ui-alert-error mb-4" role="alert">{{ error }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label for="tfMachine" class="ui-label">Applies to</label>
              <select appSearchSelect id="tfMachine" class="ui-input" [(ngModel)]="form.machine_id" name="tfMachine" [disabled]="editing"
                      [attr.aria-describedby]="editing ? 'tfMachineHint' : null">
                <option [ngValue]="null">Company default</option>
                <option *ngFor="let m of machines" [ngValue]="m.id">{{ m.machine_serial_no }}</option>
              </select>
              <p *ngIf="editing" id="tfMachineHint" class="ui-hint">To price another machine, add a tariff for it.</p>
            </div>
            <div>
              <label for="tfCost" class="ui-label">Cost per kWh</label>
              <input id="tfCost" type="number" min="0" step="0.01" class="ui-input" [(ngModel)]="form.cost_per_kwh" name="tfCost"
                     [class.is-invalid]="costError" [attr.aria-invalid]="costError ? true : null"
                     [attr.aria-describedby]="error ? 'tfError' : null">
            </div>
            <div>
              <label for="tfCurrency" class="ui-label">Currency</label>
              <input id="tfCurrency" type="text" maxlength="8" class="ui-input" [(ngModel)]="form.currency" name="tfCurrency">
            </div>
            <div>
              <label for="tfOverload" class="ui-label">Overload above (kW)</label>
              <input id="tfOverload" type="number" min="0" step="0.1" class="ui-input" [(ngModel)]="form.overload_kw" name="tfOverload"
                     [class.is-invalid]="overloadError" [attr.aria-invalid]="overloadError ? true : null"
                     [attr.aria-describedby]="error ? 'tfError' : null">
            </div>
          </div>
        </div>

        <div class="ui-dialog-footer is-split">
          <p class="ui-hint !mt-0">A cost per kWh, an overload limit, or both.</p>
          <div class="flex items-center gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" (click)="closeTariff()" [disabled]="saving">Cancel</button>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="saving">
              <span *ngIf="saving" class="ui-spinner" aria-hidden="true"></span>
              {{ saving ? 'Saving…' : 'Save tariff' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- ── EDIT HOUR RATES ── every machine at once, as before, now in the dialog -->
  <div *ngIf="showRates" class="ui-overlay">
    <div class="ui-dialog ui-dialog-lg" role="dialog" aria-modal="true" aria-labelledby="hrFormTitle">
      <div class="ui-dialog-header">
        <div>
          <h2 id="hrFormTitle" class="ui-dialog-title">Edit hour rates</h2>
          <p class="ui-dialog-subtitle">₹ per hour for each machine. Leave a machine blank if its rate is not known.</p>
        </div>
        <button type="button" class="ui-close" (click)="closeRates()" aria-label="Close without saving">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form (ngSubmit)="saveRates()" class="contents" novalidate>
        <div class="ui-dialog-body">
          <div *ngIf="ratesError" class="ui-alert ui-alert-error mb-4" role="alert">{{ ratesError }}</div>
          <div class="mexa-tablewrap" tabindex="0" role="region" aria-label="Hour rates to edit">
            <table class="mexa-table is-compact">
              <caption class="sr-only">Type each machine's hour rate in rupees per hour</caption>
              <thead>
                <tr><th scope="col">Machine</th><th scope="col" class="col-md">Model</th><th scope="col" class="qty">₹ per hour</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of rates; trackBy: rateKey" [class.hr-changed]="isChanged(r)">
                  <th scope="row" class="strong hr-name">{{ r.name }}</th>
                  <td class="col-md">{{ r.model || '--' }}</td>
                  <td class="qty">
                    <input type="number" min="0" max="1000000" step="0.01" inputmode="decimal" class="ui-input hr-input"
                           [(ngModel)]="r.value" [ngModelOptions]="{ standalone: true }" placeholder="--"
                           [disabled]="ratesSaving"
                           [attr.aria-label]="'Hour rate of ' + r.name + ', rupees per hour'"
                           [attr.aria-invalid]="badRate(r.value) ? true : null">
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="ui-dialog-footer is-split">
          <p class="ui-hint !mt-0" aria-live="polite">{{ changedRates.length ? changedRates.length + ' changed, not saved yet' : 'Nothing changed yet' }}</p>
          <div class="flex items-center gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" (click)="closeRates()" [disabled]="ratesSaving">Cancel</button>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="ratesSaving || !changedRates.length">
              <span *ngIf="ratesSaving" class="ui-spinner" aria-hidden="true"></span>
              {{ ratesSaving ? 'Saving…' : 'Save hour rates' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
  `,
  styles: [`
    /* a block, not the default inline: the page's blocks inside an inline host
       hit-test oddly (the host answers for its own row buttons) */
    :host { display: block; }
    .tf-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .75rem; }
    .tf-head > div { flex: 1 1 18rem; }
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
  /* Add / Edit tariff and Edit hour rates open in the same dialog as every
     other form in the app; the tariff form and the rate inputs used to sit
     in the page itself. */
  showTariff = false;
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
  showRates = false;
  readonly qty = qty;
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

  openRates(): void {
    for (const r of this.rates) r.value = r.saved;   // start from what is saved
    this.ratesError = '';
    this.showRates = true;
  }

  /** Closing without saving drops what was typed. */
  closeRates(): void {
    if (this.ratesSaving) return;
    for (const r of this.rates) r.value = r.saved;
    this.ratesError = '';
    this.showRates = false;
  }

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
          this.showRates = false;
          this.toast.success(changed.length === 1 ? 'Hour rate saved' : `${changed.length} hour rates saved`);
          this.cdr.markForCheck();
        },
        error: err => {
          this.ratesSaving = false;
          this.ratesError = err?.error?.message || 'Could not save the hour rates. Try again.';
          // some may have been saved: read back what is stored, keeping what was typed
          this.refreshSaved();
        }
      });
  }

  /** After a failed save: what the server now holds (some may have saved), keeping what was typed. */
  private refreshSaved(): void {
    this.machinesSvc.getMachines({ page: 1, limit: 500, sortBy: 'm.machine_serial_no', sortDir: 'asc' })
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => {
        const stored = new Map<number, number | null>((res?.data ?? []).map((m: any) => [m.id, toRate(m.hour_rate)]));
        for (const r of this.rates) if (stored.has(r.id)) r.saved = stored.get(r.id) ?? null;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private blank() { return { machine_id: null, cost_per_kwh: null, currency: 'INR', overload_kw: null }; }

  load(): void {
    this.loading = true; this.cdr.markForCheck();
    this.svc.getSettings().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.loading = false; this.settings = res?.data ?? []; this.cdr.markForCheck(); });
  }

  openTariff(): void {
    this.reset();
    this.showTariff = true;
  }

  edit(s: any): void {
    this.reset();
    this.form = { machine_id: s.machine_id ?? null, cost_per_kwh: s.cost_per_kwh, currency: s.currency || 'INR', overload_kw: s.overload_kw };
    this.editing = true;
    this.showTariff = true;
  }

  closeTariff(): void {
    if (this.saving) return;
    this.showTariff = false;
    this.reset();
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
        this.showTariff = false;
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
