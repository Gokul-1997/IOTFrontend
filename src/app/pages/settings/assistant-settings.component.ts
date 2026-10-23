import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssistantService } from '../../core/services/assistant.service';

/** A short list first, then every timezone the browser knows. */
const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC'];

/*
 * The company admin's say over the company assistant: how many answers each
 * person gets a day (0 switches it off for the company) and the company's
 * timezone, whose midnight resets the allowance. The platform's daily total
 * for the whole company is shown, not set: the admin may lower what people
 * get, never raise it past the platform's ceiling (23 Oct 2026, the user:
 * "decrease is fine, never increase").
 */
@Component({
  selector: 'app-assistant-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section *ngIf="shown" class="mexa-card" aria-labelledby="set-assistant">
      <h2 id="set-assistant" class="mexa-card-title mexa-card-title-left">{{ name }}</h2>
      <p class="mexa-setting-hint as-set-intro">The company assistant in the corner of every page, for the roles you give it. It only reads your company's MEXA data and answers nothing else.</p>
      <p *ngIf="loading" class="mexa-setting-hint" role="status">Loading…</p>
      <p *ngIf="loadError" class="mexa-note mexa-note-bad" role="alert">{{ loadError }}</p>
      <form *ngIf="!loading && !loadError" class="as-set-form" (ngSubmit)="save()" novalidate>
        <div class="ui-field">
          <label class="ui-label" for="asLimit">Answers per person per day</label>
          <input id="asLimit" name="asLimit" class="ui-input" type="number" min="0" [max]="max" step="1" inputmode="numeric"
                 [(ngModel)]="limit" [attr.aria-invalid]="limitInvalid" aria-describedby="asLimitHint">
          <p id="asLimitHint" class="ui-hint">From 0 to {{ max }}: lower it as you like (0 switches {{ name }} off for your company); it cannot go above {{ max }}.
            Questions it asks back, refusals and failures are not counted.<ng-container *ngIf="companyMax"> Your whole company has up to {{ companyMax }} questions a day.</ng-container></p>
          <p *ngIf="limitInvalid" class="ui-error" role="alert">Enter a whole number from 0 to {{ max }}.</p>
        </div>
        <div class="ui-field">
          <label class="ui-label" for="asZone">Company timezone</label>
          <select id="asZone" name="asZone" class="ui-input" [(ngModel)]="timezone" aria-describedby="asZoneHint">
            <option *ngFor="let z of zones" [ngValue]="z">{{ z }}</option>
          </select>
          <p id="asZoneHint" class="ui-hint">Each person's allowance comes back at midnight here.</p>
        </div>
        <div class="as-set-actions">
          <span class="mexa-setting-hint"><span *ngIf="saved" role="status">{{ saved }}</span></span>
          <button type="submit" class="ui-btn ui-btn-primary ui-btn-sm" [disabled]="saving || !changed">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </section>`,
  styles: [`
    .as-set-intro { margin: -.25rem 0 .75rem; }
    .as-set-form { display: grid; gap: .25rem; }
    .as-set-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  `]
})
export class AssistantSettingsComponent implements OnInit {
  private readonly svc = inject(AssistantService);
  private readonly cdr = inject(ChangeDetectorRef);

  name = 'STM Mexa AI';
  /** Only where the server has the assistant: no key, no card. */
  shown = false;
  loading = true;
  loadError = '';
  saving = false;
  saved = '';
  max = 50;
  /** The platform's daily total for the whole company (seen here, set by S&T). */
  companyMax: number | null = null;
  limit: number | null = 50;
  timezone = 'Asia/Kolkata';
  private stored = { limit: 50, timezone: 'Asia/Kolkata' };
  zones: string[] = COMMON_ZONES;

  get limitInvalid(): boolean { return !Number.isInteger(this.limit) || this.limit! < 0 || this.limit! > this.max; }
  get changed(): boolean { return this.limit !== this.stored.limit || this.timezone !== this.stored.timezone; }

  ngOnInit(): void {
    const all: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [];
    this.zones = [...COMMON_ZONES, ...all.filter(z => !COMMON_ZONES.includes(z))];
    // on, or switched off by this admin (who must be able to switch it back on)
    this.svc.loadStatus().subscribe({
      next: s => {
        this.name = s.name || this.name;
        this.shown = s.enabled || s.reason === 'SWITCHED_OFF';
        this.cdr.markForCheck();
        if (this.shown) this.loadSettings();
      },
      error: () => {}
    });
  }

  private loadSettings(): void {
    this.svc.getSettings().subscribe({
      next: s => {
        this.limit = s.daily_limit; this.timezone = s.timezone; this.max = s.max_limit; this.companyMax = s.company_daily_max ?? null;
        this.stored = { limit: s.daily_limit, timezone: s.timezone };
        if (!this.zones.includes(s.timezone)) this.zones = [s.timezone, ...this.zones];
        this.loading = false; this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.loadError = err?.status === 404 ? `${this.name} is not set up on this server yet.` : 'The setting could not be loaded. Try again later.';
        this.cdr.markForCheck();
      }
    });
  }

  save(): void {
    if (this.limitInvalid || this.saving) return;
    this.saving = true; this.saved = ''; this.cdr.markForCheck();
    this.svc.saveSettings({ daily_limit: this.limit!, timezone: this.timezone }).subscribe({
      next: s => {
        this.stored = { limit: s.daily_limit, timezone: s.timezone };
        this.saving = false;
        this.saved = s.daily_limit === 0 ? `${this.name} is off for your company.` : `Saved: ${s.daily_limit} answers per person a day.`;
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false;
        this.saved = err?.error?.message || 'Could not save. Try again.';
        this.cdr.markForCheck();
      }
    });
  }
}
