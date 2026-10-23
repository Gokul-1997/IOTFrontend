import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, catchError, of, forkJoin } from 'rxjs';
import { EbBill, EbConnection, EbReading, EnergyDashboardService } from '../energy-dashboard/energy-dashboard.service';
import { billDay, billPeriod, blankEbBill, ebBillProblem, ebDays, ebSums, EbBillForm } from '../energy-dashboard/energy-bill';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { MachinesService } from '../machines/machines.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { qty } from '../../shared/format-number';

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
 *     on the Downtime and OEE screens (machines.hour_rate);
 *   - the EB bills, per service connection, every figure as printed, and
 *     the EB meter readings: the Energy Dashboard works this bill out the
 *     same way (23 Oct 2026).
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
  imports: [CommonModule, FormsModule, RouterModule, StateComponent, SkeletonRowsComponent],
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

  <!-- the EB bills, as printed, per service connection — what the Energy Dashboard works this bill out from -->
  <section class="mexa-card mt-3 p-4" aria-labelledby="ebTitle">
    <div class="tf-head">
      <div>
        <h2 id="ebTitle" class="mexa-card-title mexa-card-title-left">Electricity bills (EB)</h2>
        <p class="mexa-card-hint">
          Each service connection's bills, every figure as printed. The Energy Dashboard works this bill out the same way;
          add each new bill when it comes.
        </p>
      </div>
      <button type="button" class="ui-btn ui-btn-primary" (click)="openConnection()">
        <span class="ui-tab-icon material-icons" aria-hidden="true">add</span>Add service connection
      </button>
    </div>
    <p *ngIf="ebLoading" class="mexa-card-hint mt-2">Loading the bills…</p>
    <p *ngIf="ebLoadError" class="text-sm text-red-700 dark:text-red-400 mt-2" role="alert">{{ ebLoadError }}</p>
    <app-state *ngIf="!ebLoading && !ebLoadError && !connections.length" icon="receipt_long" title="No service connection yet"
               text="Add each EB service connection (the SC number on the bill), then its latest bill."></app-state>

    <article *ngFor="let c of connections; trackBy: connKey" class="eb-conn" [attr.aria-labelledby]="'ebConn' + c.id">
      <div class="tf-head">
        <div>
          <h3 [id]="'ebConn' + c.id" class="eb-title">Service connection {{ c.sc_number }}<span *ngIf="c.name" class="eb-name"> · {{ c.name }}</span></h3>
          <p class="mexa-card-hint !mt-0">
            <ng-container *ngIf="c.current as p">This bill {{ billPeriod(p.start, p.end) }} · {{ p.days }} days · {{ c.cycle }}</ng-container>
            <ng-container *ngIf="!c.current">Add its latest bill to start the forecast</ng-container>
            <ng-container *ngIf="c.meter"> · meter on the supply: {{ c.meter.machine }}</ng-container>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" (click)="openBill(c)">
            <span class="material-icons" aria-hidden="true">add</span>Add bill</button>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="openReadings(c)">
            <span class="material-icons" aria-hidden="true">speed</span>Meter readings ({{ c.readings.length }})</button>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="openConnection(c)" [attr.aria-label]="'Edit service connection ' + c.sc_number">
            <span class="material-icons" aria-hidden="true">edit</span>Edit</button>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="removeConnection(c)" [attr.aria-label]="'Remove service connection ' + c.sc_number">
            <span class="material-icons" aria-hidden="true">delete</span>Remove</button>
        </div>
      </div>
      <div *ngIf="c.bills.length" class="mexa-tablewrap mt-2" tabindex="0" role="region" [attr.aria-label]="'Bills of service connection ' + c.sc_number">
        <table class="mexa-table is-compact eb-table">
          <caption class="sr-only">Bills of service connection {{ c.sc_number }}, newest first, as printed</caption>
          <thead>
            <tr>
              <th scope="col">From</th><th scope="col">To</th><th scope="col" class="qty">Units</th><th scope="col" class="qty">Rate</th>
              <th scope="col" class="qty col-md">Peak hour</th><th scope="col" class="qty">Electricity charges</th><th scope="col" class="qty">Fixed charges</th>
              <th scope="col" class="qty">ED/LPF penalty</th><th scope="col" class="qty">Welding surcharge</th><th scope="col" class="qty">E Tax &amp; TCS</th>
              <th scope="col" class="qty col-md">Other</th><th scope="col" class="qty">Net bill</th>
              <th scope="col" class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let b of c.bills; trackBy: billKey">
              <td>{{ asPrinted(b.from) }}</td><td>{{ asPrinted(b.to) }}</td>
              <td class="num qty">{{ qty(b.units, 2) }}</td><td class="num qty">{{ b.rate ?? '--' }}</td>
              <td class="num qty col-md">{{ qty(b.peak_charges, 2) }}</td><td class="num qty">{{ qty(b.electricity_charges, 2) }}</td>
              <td class="num qty">{{ qty(b.fixed_charges, 2) }}</td><td class="num qty">{{ qty(b.penalty_charges, 2) }}</td>
              <td class="num qty">{{ qty(b.welding_charges, 2) }}</td><td class="num qty">{{ qty(b.tax_charges, 2) }}</td>
              <td class="num qty col-md">{{ qty(b.other_charges, 2) }}</td><td class="num qty strong">₹{{ qty(b.net_amount, 2) }}</td>
              <td class="actions whitespace-nowrap">
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" (click)="openBill(c, b)" [attr.aria-label]="'Edit the bill of ' + asPrinted(b.from) + ' to ' + asPrinted(b.to)">
                  <span class="material-icons" aria-hidden="true">edit</span></button>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" (click)="removeBill(c, b)" [attr.aria-label]="'Remove the bill of ' + asPrinted(b.from) + ' to ' + asPrinted(b.to)">
                  <span class="material-icons" aria-hidden="true">delete</span></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
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
              <select id="tfMachine" class="ui-input" [(ngModel)]="form.machine_id" name="tfMachine" [disabled]="editing"
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
  <!-- ── SERVICE CONNECTION ── -->
  <div *ngIf="showConn" class="ui-overlay">
    <div class="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="connFormTitle">
      <div class="ui-dialog-header">
        <div>
          <h2 id="connFormTitle" class="ui-dialog-title">{{ connForm.id ? 'Edit service connection' : 'Add service connection' }}</h2>
          <p class="ui-dialog-subtitle">One for each EB supply: the service connection number printed on its bill.</p>
        </div>
        <button type="button" class="ui-close" (click)="closeConnection()" aria-label="Close without saving">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <form (ngSubmit)="saveConnection()" class="contents" novalidate>
        <div class="ui-dialog-body">
          <div *ngIf="connError" class="ui-alert ui-alert-error mb-4" role="alert">{{ connError }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="connNumber" class="ui-label">Service connection no.</label>
              <input id="connNumber" type="text" maxlength="40" class="ui-input" [(ngModel)]="connForm.sc_number" name="connNumber" required>
            </div>
            <div>
              <label for="connName" class="ui-label">Name (optional)</label>
              <input id="connName" type="text" maxlength="80" class="ui-input" [(ngModel)]="connForm.name" name="connName" placeholder="e.g. Main plant">
            </div>
            <div class="sm:col-span-2">
              <label for="connMeter" class="ui-label">Meter on the whole supply (optional)</label>
              <select id="connMeter" class="ui-input" [(ngModel)]="connForm.meter_machine_id" name="connMeter" aria-describedby="connMeterHint">
                <option [ngValue]="null">None</option>
                <option *ngFor="let m of machines" [ngValue]="m.id">{{ m.machine_serial_no }}</option>
              </select>
              <p id="connMeterHint" class="ui-hint">Only an energy meter on the EB incomer, measuring everything on this supply. Without one, enter EB meter readings for exact units.</p>
            </div>
          </div>
        </div>
        <div class="ui-dialog-footer">
          <button type="button" class="ui-btn ui-btn-ghost" (click)="closeConnection()" [disabled]="connSaving">Cancel</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="connSaving">
            <span *ngIf="connSaving" class="ui-spinner" aria-hidden="true"></span>{{ connSaving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── EB BILL, AS PRINTED ── -->
  <div *ngIf="showBill" class="ui-overlay">
    <div class="ui-dialog ui-dialog-lg" role="dialog" aria-modal="true" aria-labelledby="ebBillTitle">
      <div class="ui-dialog-header">
        <div>
          <h2 id="ebBillTitle" class="ui-dialog-title">{{ billEditId ? 'Edit bill' : 'Add bill' }} · SC {{ billConn?.sc_number }}</h2>
          <p class="ui-dialog-subtitle">Every figure as printed on the EB bill.</p>
        </div>
        <button type="button" class="ui-close" (click)="closeBill()" aria-label="Close without saving">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <form (ngSubmit)="saveBill()" class="contents" novalidate>
        <div class="ui-dialog-body">
          <div id="ebBillError" *ngIf="billError" class="ui-alert ui-alert-error mb-4" role="alert">{{ billError }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="ebFrom" class="ui-label">Billing period From</label>
              <input id="ebFrom" type="date" class="ui-input" [(ngModel)]="billForm.from" name="ebFrom" required>
            </div>
            <div>
              <label for="ebTo" class="ui-label">To</label>
              <input id="ebTo" type="date" class="ui-input" [(ngModel)]="billForm.to" name="ebTo" required [min]="billForm.from"
                     aria-describedby="ebDays">
              <p id="ebDays" class="ui-hint" aria-live="polite">{{ billDaysText }}</p>
            </div>
            <div *ngFor="let f of billFields">
              <label [for]="'eb_' + f.key" class="ui-label">{{ f.label }}</label>
              <input [id]="'eb_' + f.key" type="number" step="any" inputmode="decimal" class="ui-input eb-num"
                     [(ngModel)]="billForm[f.key]" [name]="'eb_' + f.key" [attr.min]="f.key === 'other_charges' ? null : 0"
                     [placeholder]="placeholderFor(f.key)" [attr.aria-describedby]="f.hint ? 'eb_' + f.key + '_hint' : null">
              <p *ngIf="f.hint" [id]="'eb_' + f.key + '_hint'" class="ui-hint">{{ f.hint }}</p>
            </div>
          </div>
          <p class="eb-check" aria-live="polite" [class.is-off]="(billSums.net_difference ?? 0) !== 0">{{ billCheckText }}</p>
          <p *ngIf="billRateText" class="ui-hint">{{ billRateText }}</p>
        </div>
        <div class="ui-dialog-footer">
          <button type="button" class="ui-btn ui-btn-ghost" (click)="closeBill()" [disabled]="billSaving">Cancel</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="billSaving">
            <span *ngIf="billSaving" class="ui-spinner" aria-hidden="true"></span>{{ billSaving ? 'Saving…' : 'Save bill' }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── EB METER READINGS ── -->
  <div *ngIf="showReadings" class="ui-overlay">
    <div class="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="ebReadTitle">
      <div class="ui-dialog-header">
        <div>
          <h2 id="ebReadTitle" class="ui-dialog-title">EB meter readings · SC {{ readingsConn?.sc_number }}</h2>
          <p class="ui-dialog-subtitle">The kWh register on the EB meter, read about the same time each day (or week). With a reading on the bill's From date, this bill's units are exact.</p>
        </div>
        <button type="button" class="ui-close" (click)="closeReadings()" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <form (ngSubmit)="saveReading()" class="contents" novalidate>
        <div class="ui-dialog-body">
          <div *ngIf="readingError" class="ui-alert ui-alert-error mb-4" role="alert">{{ readingError }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label for="ebReadOn" class="ui-label">Date</label>
              <input id="ebReadOn" type="date" class="ui-input" [(ngModel)]="readingForm.read_on" name="ebReadOn" required>
            </div>
            <div>
              <label for="ebReadKwh" class="ui-label">Reading (kWh)</label>
              <input id="ebReadKwh" type="number" min="0" step="any" inputmode="decimal" class="ui-input eb-num" [(ngModel)]="readingForm.kwh" name="ebReadKwh" required>
            </div>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="readingSaving">
              <span *ngIf="readingSaving" class="ui-spinner" aria-hidden="true"></span>{{ readingSaving ? 'Saving…' : 'Add reading' }}
            </button>
          </div>
          <div class="mexa-tablewrap mt-4" tabindex="0" role="region" aria-label="Readings, newest first">
            <table class="mexa-table is-compact">
              <caption class="sr-only">EB meter readings of service connection {{ readingsConn?.sc_number }}, newest first</caption>
              <thead><tr><th scope="col">Date</th><th scope="col" class="qty">Reading (kWh)</th><th scope="col" class="qty">Units since the one before</th>
                         <th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                <tr *ngFor="let r of readingsConn?.readings ?? []; let i = index; trackBy: readingKey">
                  <td>{{ asPrinted(r.read_on) }}</td>
                  <td class="num qty">{{ qty(r.kwh, 2) }}</td>
                  <td class="num qty">{{ unitsSince(i) }}</td>
                  <td class="actions"><button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" (click)="removeReading(r)" [attr.aria-label]="'Remove the reading of ' + asPrinted(r.read_on)">
                    <span class="material-icons" aria-hidden="true">delete</span></button></td>
                </tr>
                <tr *ngIf="!readingsConn?.readings?.length"><td colspan="4" class="mexa-empty">No readings yet.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </div>
  </div>
  `,
  styles: [`
    /* the EB bills: one block per service connection, its bills as a table like the bill */
    .eb-conn { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--mexa-rule); }
    .eb-title { margin: 0; font-size: 1rem; font-weight: 700; color: var(--mexa-ink); }
    .eb-name { font-weight: 500; color: var(--mexa-ink-2); }
    .eb-table td, .eb-table th { white-space: nowrap; }
    .eb-num { text-align: right; font-variant-numeric: tabular-nums; }
    .eb-check { margin: 1rem 0 0; padding: .55rem .75rem; border-radius: 10px; background: var(--mexa-row-alt); font-weight: 600; }
    .eb-check.is-off { color: #b45309; }
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

  /* ── the EB bills ── */
  connections: EbConnection[] = [];
  ebLoading = false;
  ebLoadError = '';
  readonly billPeriod = billPeriod;

  showConn = false;
  connSaving = false;
  connError = '';
  connForm: { id: number | null; sc_number: string; name: string; meter_machine_id: number | null } = { id: null, sc_number: '', name: '', meter_machine_id: null };

  showBill = false;
  billSaving = false;
  billError = '';
  billConn: EbConnection | null = null;
  billEditId: number | null = null;
  billForm: EbBillForm = blankEbBill();
  /** The bill's figures, in the order the EB bill prints them. */
  readonly billFields: { key: Exclude<keyof EbBillForm, 'from' | 'to'>; label: string; hint?: string }[] = [
    { key: 'units', label: 'Assessed units' },
    { key: 'rate', label: 'Rate per unit (₹)' },
    { key: 'electricity_charges', label: 'Electricity charges (₹)', hint: 'Left blank: units × rate.' },
    { key: 'peak_charges', label: 'Peak hour charges (₹)' },
    { key: 'fixed_charges', label: 'Fixed charges (₹)' },
    { key: 'penalty_charges', label: 'ED/LPF penalty (₹)' },
    { key: 'welding_charges', label: 'Welding surcharge (₹)' },
    { key: 'tax_charges', label: 'E Tax & TCS (₹)' },
    { key: 'other_charges', label: 'Other charges (₹)', hint: 'Arrears or adjustments; a credit as a minus. Not carried into the forecast.' },
    { key: 'net_amount', label: 'Net bill value (₹)', hint: 'Left blank: the charges added up.' }
  ];

  showReadings = false;
  readingSaving = false;
  readingError = '';
  readingsConn: EbConnection | null = null;
  readingForm: { read_on: string; kwh: number | null } = { read_on: '', kwh: null };

  constructor(private svc: EnergyDashboardService, private machinesSvc: MachinesService, auth: AuthService,
              private toast: ToastService, private cdr: ChangeDetectorRef, private confirm: ConfirmService) {
    this.canEditRates = auth.hasAction('machines', 'edit');
    this.canViewRates = this.canEditRates || auth.hasAction('machines', 'view');
  }

  ngOnInit(): void {
    this.svc.getMeta().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });
    this.load();
    this.loadConnections();
    if (this.canViewRates) this.loadRates();
  }

  /* ── the EB bills ── */

  private todayStr(): string { return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); }

  loadConnections(): void {
    this.ebLoading = true; this.ebLoadError = ''; this.cdr.markForCheck();
    this.svc.getConnections().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.ebLoading = false;
        this.connections = res?.data ?? [];
        // the open dialogs follow the fresh figures
        if (this.readingsConn) this.readingsConn = this.connections.find(c => c.id === this.readingsConn!.id) ?? null;
        this.cdr.markForCheck();
      },
      error: err => {
        this.ebLoading = false;
        this.ebLoadError = err?.error?.message || 'Could not load the electricity bills. Reload the page to try again.';
        this.cdr.markForCheck();
      }
    });
  }

  connKey(_: number, c: EbConnection): number { return c.id; }
  billKey(_: number, b: EbBill): number { return b.id; }
  readingKey(_: number, r: EbReading): number { return r.id; }

  openConnection(c?: EbConnection): void {
    this.connForm = c ? { id: c.id, sc_number: c.sc_number, name: c.name ?? '', meter_machine_id: c.meter?.machine_id ?? null }
                      : { id: null, sc_number: '', name: '', meter_machine_id: null };
    this.connError = '';
    this.showConn = true;
  }

  closeConnection(): void { if (!this.connSaving) { this.showConn = false; this.connError = ''; } }

  saveConnection(): void {
    const f = this.connForm;
    if (!f.sc_number.trim()) { this.connError = 'Enter the service connection number, as on the bill.'; this.cdr.markForCheck(); return; }
    this.connSaving = true; this.connError = ''; this.cdr.markForCheck();
    this.svc.saveConnection({ sc_number: f.sc_number.trim(), name: f.name.trim() || null, meter_machine_id: f.meter_machine_id }, f.id ?? undefined)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.connSaving = false; this.showConn = false;
          this.toast.success(f.id ? 'Service connection saved' : `Service connection ${f.sc_number.trim()} added`);
          this.loadConnections();
        },
        error: err => {
          this.connSaving = false;
          this.connError = err?.error?.message || 'Could not save the service connection. Try again.';
          this.cdr.markForCheck();
        }
      });
  }

  async removeConnection(c: EbConnection): Promise<void> {
    const yes = await this.confirm.ask({
      title: `Remove service connection ${c.sc_number}?`,
      message: 'Its bills and meter readings go with it, and the Energy Dashboard stops forecasting its bill.',
      confirmText: 'Remove', icon: 'delete_forever'
    });
    if (!yes) return;
    this.svc.deleteConnection(c.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success(`Service connection ${c.sc_number} removed`); this.loadConnections(); },
      error: err => this.toast.error(err?.error?.message || 'Could not remove the service connection. Try again.')
    });
  }

  /** A new bill starts where the last one ended (its To is the new From). */
  openBill(c: EbConnection, b?: EbBill): void {
    this.billConn = c;
    this.billEditId = b?.id ?? null;
    this.billForm = b ? {
      from: b.from, to: b.to, units: b.units, rate: b.rate, electricity_charges: b.electricity_charges,
      peak_charges: b.peak_charges, fixed_charges: b.fixed_charges, penalty_charges: b.penalty_charges,
      welding_charges: b.welding_charges, tax_charges: b.tax_charges, other_charges: b.other_charges, net_amount: b.net_amount
    } : { ...blankEbBill(), from: c.bills[0]?.to ?? '', rate: c.bills[0]?.rate ?? null, fixed_charges: c.bills[0]?.fixed_charges ?? null };
    this.billError = '';
    this.showBill = true;
  }

  closeBill(): void { if (!this.billSaving) { this.showBill = false; this.billError = ''; } }

  get billSums() { return ebSums(this.billForm); }

  get billDaysText(): string {
    const d = ebDays(this.billForm.from, this.billForm.to);
    return d === null ? 'The To date starts the next bill: 26 Jul to 26 Aug is 31 days.' : d > 0 ? `${d} days` : 'The To date must be after the From date.';
  }

  /** What a blank figure will be taken as. */
  placeholderFor(key: Exclude<keyof EbBillForm, 'from' | 'to'>): string {
    const s = this.billSums;
    if (key === 'electricity_charges' && s.electricity !== null) return String(s.electricity);
    if (key === 'net_amount' && s.sum !== null) return String(s.sum);
    return key === 'units' || key === 'rate' || key === 'electricity_charges' || key === 'net_amount' ? '' : '0';
  }

  /** "26-07-2026", the way the EB bill prints a date. */
  asPrinted(day: string): string { return day ? day.split('-').reverse().join('-') : ''; }

  /** Do the charges add up to the net bill? Said as it is typed. */
  get billCheckText(): string {
    const s = this.billSums;
    if (s.sum === null) return 'The charges add up as you type them.';
    const total = `₹${qty(s.sum, 2)}`;
    if (s.net_difference === null) return `The charges add up to ${total}: that is the net bill.`;
    if (s.net_difference === 0) return `The charges add up to ${total} — the same as the net bill.`;
    return `The charges add up to ${total} — ₹${qty(Math.abs(s.net_difference), 2)} ${s.net_difference > 0 ? 'less' : 'more'} than the net bill: check the figures.`;
  }

  /** The printed rate is often rounded: say how far units × rate is from the charges. */
  get billRateText(): string {
    const d = this.billSums.rate_difference;
    if (d === null || d === 0) return '';
    return `Units × rate is ₹${qty(Math.abs(d), 2)} ${d > 0 ? 'less' : 'more'} than the electricity charges — the printed rate is rounded; the forecast uses the rate the bill really charged.`;
  }

  saveBill(): void {
    const problem = ebBillProblem(this.billForm, this.todayStr());
    if (problem) { this.billError = problem; this.cdr.markForCheck(); return; }
    const c = this.billConn!;
    const body: any = {};
    for (const [k, v] of Object.entries(this.billForm)) body[k] = v === null || (v as any) === '' ? null : v;
    this.billSaving = true; this.billError = ''; this.cdr.markForCheck();
    this.svc.saveEbBill(c.id, body, this.billEditId ?? undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.billSaving = false; this.showBill = false;
        this.toast.success(this.billEditId ? 'Bill saved' : `Bill of ${billDay(body.from)} – ${billDay(body.to)} added`);
        this.loadConnections();
      },
      error: err => {
        this.billSaving = false;
        this.billError = err?.error?.message || 'Could not save the bill. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  async removeBill(c: EbConnection, b: EbBill): Promise<void> {
    const yes = await this.confirm.ask({
      title: `Remove the bill of ${this.asPrinted(b.from)} – ${this.asPrinted(b.to)}?`,
      message: `Service connection ${c.sc_number}. The forecast then works from its other bills.`,
      confirmText: 'Remove', icon: 'delete_forever'
    });
    if (!yes) return;
    this.svc.deleteEbBill(c.id, b.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success('Bill removed'); this.loadConnections(); },
      error: err => this.toast.error(err?.error?.message || 'Could not remove the bill. Try again.')
    });
  }

  openReadings(c: EbConnection): void {
    this.readingsConn = c;
    this.readingForm = { read_on: this.todayStr(), kwh: null };
    this.readingError = '';
    this.showReadings = true;
  }

  closeReadings(): void { if (!this.readingSaving) { this.showReadings = false; this.readingError = ''; } }

  /** Units between a reading and the one before it (the list is newest first). */
  unitsSince(i: number): string {
    const list = this.readingsConn?.readings ?? [];
    const before = list[i + 1];
    return before ? qty(list[i].kwh - before.kwh, 2) : '--';
  }

  saveReading(): void {
    const { read_on, kwh } = this.readingForm;
    if (!read_on || kwh === null || (kwh as any) === '' || Number(kwh) < 0) {
      this.readingError = 'Enter the date and the reading (kWh).'; this.cdr.markForCheck(); return;
    }
    this.readingSaving = true; this.readingError = ''; this.cdr.markForCheck();
    this.svc.saveReading(this.readingsConn!.id, { read_on, kwh: Number(kwh) }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.readingSaving = false;
        this.readingForm = { read_on, kwh: null };
        this.toast.success('Reading saved');
        this.loadConnections();
      },
      error: err => {
        this.readingSaving = false;
        this.readingError = err?.error?.message || 'Could not save the reading. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  async removeReading(r: EbReading): Promise<void> {
    const c = this.readingsConn!;
    const yes = await this.confirm.ask({ title: `Remove the reading of ${this.asPrinted(r.read_on)}?`, confirmText: 'Remove', icon: 'delete_forever' });
    if (!yes) return;
    this.svc.deleteReading(c.id, r.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success('Reading removed'); this.loadConnections(); },
      error: err => this.toast.error(err?.error?.message || 'Could not remove the reading. Try again.')
    });
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
