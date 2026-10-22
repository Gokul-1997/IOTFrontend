import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { ReportsService, ReportFilters, ReportType, MAX_DIRECT_DAYS, rangeDays } from './reports.service';
import { ActivatedRoute, Router } from '@angular/router';
import { OeeReportsComponent } from '../oee-reports/oee-reports';
import { MachineOeeReportComponent } from './machine-oee-report.component';
import { AuthService } from '../../core/services/auth.service';
import { UiTabsDirective } from '../../shared/ui-tabs.directive';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { takeLinkedFilters } from '../../shared/linked-filters';
import { Subscription } from 'rxjs';
import { StateComponent } from '../../shared/state/state.component';
import { qty } from '../../shared/format-number';
import { ToastService } from '../../core/services/toast.service';
import { downloadError, saveOrMessage } from '../../shared/report-file';
import { pctText, pctTone } from '../../shared/report-value';
import { AssistantService } from '../../core/services/assistant.service';

type Tab = ReportType | 'oee-records' | 'machine-oee';

/* ── Column definition ── */
interface ColDef {
  key:      string;
  label:    string;
  align?:   'left' | 'center' | 'right';
  default:  boolean;   // shown by default when tab first loads
}

interface KpiCard {
  label: string;
  value: string | number;
  unit:  string;
  icon:  string;   // a Material icon name
  color: string;
  help:  string;   // the metric-help topic for its (i)
}

/* ─── ALL available columns per report type ─── */
const COL_DEFS: Record<ReportType, ColDef[]> = {
  'production': [
    { key: 'machine',      label: 'Machine',       align: 'left',   default: true  },
    { key: 'operator',     label: 'Operator',      align: 'left',   default: true  },
    { key: 'shift',        label: 'Shift',         align: 'left',   default: true  },
    { key: 'hour',         label: 'Hour',          align: 'left',   default: true  },
    { key: 'run_time',     label: 'Run Time',      align: 'center', default: true  },
    { key: 'idle_time',    label: 'Idle Time',     align: 'center', default: true  },
    { key: 'setup_time',   label: 'Setup Time',    align: 'center', default: false },
    { key: 'off_time',     label: 'Off Time',      align: 'center', default: false },

    { key: 'produced_qty', label: 'Parts Made',    align: 'center', default: true  },
    { key: 'energy_kwh',   label: 'Energy (kWh)',  align: 'right',  default: true  },
  ],
  'oee-hourly': [
    { key: 'machine',      label: 'Machine',         align: 'left',   default: true },
    { key: 'operator',     label: 'Operator',         align: 'left',   default: true },
    { key: 'hour',         label: 'Hour',             align: 'left',   default: true },
    { key: 'availability', label: 'Availability %',   align: 'center', default: true },
    { key: 'performance',  label: 'Performance %',    align: 'center', default: true },
    { key: 'quality',      label: 'Quality %',        align: 'center', default: true },
    { key: 'oee',          label: 'OEE %',            align: 'center', default: true },
  ],
  'shift-oee': [
    { key: 'machine',      label: 'Machine',         align: 'left',   default: true },
    { key: 'operator',     label: 'Operator',         align: 'left',   default: true },
    { key: 'shift',        label: 'Shift',            align: 'left',   default: true },
    { key: 'date',         label: 'Date',             align: 'left',   default: true },
    { key: 'availability', label: 'Availability %',   align: 'center', default: true },
    { key: 'performance',  label: 'Performance %',    align: 'center', default: true },
    { key: 'quality',      label: 'Quality %',        align: 'center', default: true },
    { key: 'oee',          label: 'OEE %',            align: 'center', default: true },
  ]
};

@Component({
  standalone: true,
  selector: 'app-reports',
  imports: [MexaPagerComponent, StateComponent, MetricHelpComponent, ReportDateDirective, UiTabsDirective, AutoApplyDirective, CommonModule, FormsModule, OeeReportsComponent, MachineOeeReportComponent],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Reports implements OnInit, OnDestroy {
  private reportSub?: Subscription;
  private readonly assistant = inject(AssistantService);
  ngOnDestroy(): void { this.reportSub?.unsubscribe(); this.assistant.setContext(null); }

  /** The report assistant answers about what is on screen when a question does not say. */
  private shareContext(): void {
    if (!this.isBuilt) return;                           // the OEE tabs share their own
    const f = this.filters;
    this.assistant.setContext({
      report: this.rt, title: this.tabLabel + ' report', from: f.date_from, to: f.date_to,
      machine: f.machine_id ? this.labelOf(this.machines, f.machine_id) : null,
      shift: f.shift_id ? this.labelOf(this.shifts, f.shift_id) : null
    });
  }


  @ViewChild('colPanel') colPanelRef?: ElementRef;
  @ViewChild('colBtn')   colBtnRef?:   ElementRef;

  /* ── One toolbar for every tab ──
     The OEE Records and Machine OEE tabs used to draw their own search and
     export row under this toolbar, whose buttons meanwhile acted on the
     hidden Production report. The toolbar now exports whichever tab is
     open — CSV and Excel on every tab — under that tab's own permission.
     There is no Email button (21 Oct 2026): a report too large to download
     is emailed by itself, and the message saying so is all that is shown. */
  @ViewChild(OeeReportsComponent) oeeRecords?: OeeReportsComponent;
  @ViewChild(MachineOeeReportComponent) machineOee?: MachineOeeReportComponent;

  get canExportTab(): boolean {
    if (this.isBuilt) return this.auth.hasWidget('reports', 'export');
    if (this.activeTab === 'oee-records') return this.auth.hasWidget('oee-reports', 'export');
    return this.auth.hasAction('analytics-oee', 'export');
  }
  get tabLabel(): string { return this.tabs.find(t => t.id === this.activeTab)?.label || 'report'; }

  /** OEE Records' record count (it pages on the server): nothing to export at 0. */
  oeeRecordsTotal = 0;
  /** A built report's file on its way. */
  exporting: '' | 'csv' | 'xlsx' = '';

  /** Nothing to export yet: no rows (or no columns) for these filters, or a file already coming. */
  get exportDisabled(): boolean {
    if (this.isBuilt) {
      return !!this.exporting || this.loading || this.selectedCount === 0 || (!this.rangeTooLong && this.rows.length === 0);
    }
    if (this.activeTab === 'oee-records') return this.oeeRecordsTotal === 0;
    return false;
  }

  toolbarCsv(): void { this.exportTab('csv'); }
  toolbarExcel(): void { this.exportTab('xlsx'); }

  private exportTab(format: 'csv' | 'xlsx'): void {
    if (this.isBuilt) this.exportBuilt(format);
    else if (this.activeTab === 'oee-records') this.oeeRecords?.export(format);
    else this.machineOee?.export(format);
  }

  /* ── A large report is emailed: this message is what the screen shows ── */
  notice = '';
  showNotice(message: string): void { this.notice = message; this.cdr.markForCheck(); }
  onOeeRecordsTotal(total: number): void { this.oeeRecordsTotal = total; this.cdr.markForCheck(); }

  /* ── tabs ── */
  /* Every report lives here — the OEE Reports page and the OEE Dashboard's
     machine summary used to be separate places. Each tab shows only to a
     role that may open it: the production reports need Reports, the OEE ones
     need OEE Reports (and the machine summary the OEE Dashboard's data too). */
  private readonly allTabs: { id: Tab; label: string; icon: string; allowed: () => boolean }[] = [
    { id: 'production',  label: 'Production',  icon: 'settings', allowed: () => this.auth.hasPermission('page:reports') },
    { id: 'oee-hourly',  label: 'OEE Hourly',  icon: 'bar_chart', allowed: () => this.auth.hasPermission('page:reports') },
    { id: 'shift-oee',   label: 'Shift OEE',   icon: 'loop', allowed: () => this.auth.hasPermission('page:reports') },
    { id: 'oee-records', label: 'OEE Records', icon: 'note', allowed: () => this.auth.hasPermission('page:oee-reports') },
    { id: 'machine-oee', label: 'Machine OEE', icon: 'precision_manufacturing',
      allowed: () => this.auth.hasPermission('page:oee-reports') && this.auth.hasPermission('page:analytics-oee') },
  ];
  tabs: { id: Tab; label: string; icon: string }[] = [];
  activeTab: Tab = 'production';

  /** The active tab as one of the three built reports (only read when isBuilt). */
  private get rt(): ReportType { return this.activeTab as ReportType; }

  /** The three reports this page builds itself (columns, filters, table). */
  get isBuilt(): boolean { return ['production', 'oee-hourly', 'shift-oee'].includes(this.activeTab); }

  /* ── filters ── */
  filters: ReportFilters = {
    date_from:   this.todayStr(),
    date_to:     this.todayStr(),
    machine_id:  '',
    shift_id:    '',
    operator_id: ''
  };

  machines:  any[] = [];
  shifts:    any[] = [];
  operators: any[] = [];

  /* ── column builder ── */
  colBuilderOpen  = false;
  selectedColKeys = new Set<string>();   // keys currently selected

  get allColumns(): ColDef[] { return COL_DEFS[this.rt]; }

  /** Columns that will actually render (in original order) */
  get activeColumns(): ColDef[] {
    return this.allColumns.filter(c => this.selectedColKeys.has(c.key));
  }

  get selectedCount(): number { return this.selectedColKeys.size; }

  /* ── data state ── */
  loading  = false;
  rows:    any[] = [];
  kpis:    KpiCard[] = [];
  summary: any = {};

  /* ── pagination ── */
  page     = 1;
  pageSize = 15;

  /* ── delivery ──
     A range up to three months is answered in the page; beyond that the
     server refuses it (413 RANGE_TOO_LARGE) — the Excel / CSV of it is then
     emailed. The rule is enforced on the server — this mirrors it so the UI
     can explain the position before anything is pressed. */
  maxDirectDays = MAX_DIRECT_DAYS;
  loadErr = '';

  get rangeDays(): number { return rangeDays(this.filters.date_from, this.filters.date_to); }
  get rangeTooLong(): boolean { return this.rangeDays > this.maxDirectDays; }

  /* ── sort ── */
  sortCol = '';
  sortDir: 'asc' | 'desc' = 'asc';

  constructor(
    private svc: ReportsService,
    private cdr: ChangeDetectorRef,
    public  auth: AuthService,
    private route: ActivatedRoute,
    private toast: ToastService
  ) {}

  private readonly router = inject(Router);

  ngOnInit(): void {
    this.tabs = this.allTabs.filter(t => t.allowed());
    this.activeTab = this.tabs[0]?.id ?? 'production';
    // ?tab=… opens a given report (the old /oee-reports address lands on OEE Records)
    const wanted = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (wanted && this.tabs.some(t => t.id === wanted)) this.activeTab = wanted;
    if (!this.isBuilt) return;     // Machine OEE takes its own ?from=&to=&shift_id=
    // a Factory Overall tile opens the Production report on its day, shift and machine
    const linked = takeLinkedFilters(this.route, this.router);
    if (linked.from) { this.filters.date_from = linked.from; this.filters.date_to = linked.to!; }
    if (linked.machine_id) this.filters.machine_id = String(linked.machine_id);
    if (linked.shift_id) this.filters.shift_id = String(linked.shift_id);
    this.loadFilterLists();
    this.resetColSelection();
    this.loadReport();
  }

  /** The machine / shift / operator lists for the built reports' filters —
   *  once, on the first built tab shown (a page opened on an OEE tab has not
   *  needed them yet). */
  private filterListsLoaded = false;
  private loadFilterLists(): void {
    if (this.filterListsLoaded) return;
    this.filterListsLoaded = true;
    this.svc.getMachines().subscribe({  next: r => { this.machines  = r.data; this.cdr.markForCheck(); } });
    this.svc.getShifts().subscribe({    next: r => { this.shifts    = r.data; this.cdr.markForCheck(); } });
    this.loadOperators();
  }

  loadOperators(machine_id?: string): void {
    this.svc.getOperators(machine_id).subscribe({
      next: r => { this.operators = r.data; this.cdr.markForCheck(); }
    });
  }

  onMachineChange(): void {
    this.filters.operator_id = '';
    this.loadOperators(this.filters.machine_id || undefined);
  }

  /* ── tab switch ── */
  setTab(tab: Tab): void {
    this.activeTab = tab;
    if (!this.isBuilt) { this.cdr.markForCheck(); return; }   // the embedded report loads itself
    this.loadFilterLists();
    this.page      = 1;
    this.sortCol   = '';
    this.colBuilderOpen = false;
    this.resetColSelection();
    this.loadReport();
  }

  /* ── column builder ── */
  toggleColBuilder(): void { this.colBuilderOpen = !this.colBuilderOpen; }

  toggleCol(key: string): void {
    this.selectedColKeys.has(key)
      ? this.selectedColKeys.delete(key)
      : this.selectedColKeys.add(key);
    // force OnPush to see the Set mutation
    this.selectedColKeys = new Set(this.selectedColKeys);
  }

  selectAllCols(): void  { this.selectedColKeys = new Set(this.allColumns.map(c => c.key)); }
  clearAllCols(): void   { this.selectedColKeys = new Set(); }

  resetColSelection(): void {
    this.selectedColKeys = new Set(COL_DEFS[this.rt].filter(c => c.default).map(c => c.key));
  }

  /** Returns the name of an item by id from a dropdown list */
  labelOf(list: { id: any; name: string }[], id: string): string {
    return list.find(x => String(x.id) === String(id))?.name ?? id;
  }

  /** Close column panel when clicking outside */
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.colBuilderOpen) return;
    const panel = this.colPanelRef?.nativeElement;
    const btn   = this.colBtnRef?.nativeElement;
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      this.colBuilderOpen = false;
      this.cdr.markForCheck();
    }
  }

  /* ── filters ── */
  applyFilters(): void { this.page = 1; this.loadReport(); }

  resetFilters(): void {
    this.filters = {
      date_from: this.todayStr(), date_to: this.todayStr(),
      machine_id: '', shift_id: '', operator_id: ''
    };
    this.page = 1;
    this.loadOperators();
    this.loadReport();
  }

  /* ── load data ── */
  loadReport(): void {
    this.loadErr = '';
    this.shareContext();

    /* Asking anyway would cost a round trip to be told no. The banner in the
       template says so, and that Excel or CSV will email the whole range. */
    if (this.rangeTooLong) {
      this.loading = false;
      this.rows    = [];
      this.kpis    = [];
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.rows    = [];
    this.kpis    = [];
    this.cdr.markForCheck();

    const obs$ =
      this.activeTab === 'production' ? this.svc.getProductionData(this.filters) :
      this.activeTab === 'oee-hourly' ? this.svc.getOeeHourlyData(this.filters)  :
                                        this.svc.getShiftOeeData(this.filters);

    /* The filters apply themselves, so a second change can come while the
       first answer is on its way: the earlier request is dropped and only
       the latest choice is ever shown. */
    this.reportSub?.unsubscribe();
    this.reportSub = obs$.subscribe({
      next: (res: any) => {
        this.rows    = res.data.rows    || [];
        this.summary = res.data.summary || {};
        this.kpis    = this.buildKpis(this.rt, this.summary);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        /* The server is the authority on the limit; if it refuses a range the
           client thought was fine, say what it said. */
        if (err?.error?.code === 'RANGE_TOO_LARGE') {
          this.loadErr = err.error.message || 'That range is too long to show on screen. Press Excel or CSV to have it emailed.';
        }
        this.cdr.markForCheck();
      }
    });
  }

  /* ── sort ── */
  sort(col: string): void {
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = col;
      this.sortDir = 'asc';
    }
    this.page = 1;
  }

  get sortedRows(): any[] {
    if (!this.sortCol) return this.rows;
    return [...this.rows].sort((a, b) => {
      const av = a[this.sortCol] ?? '';
      const bv = b[this.sortCol] ?? '';
      const cmp = isNaN(Number(av)) ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return this.sortDir === 'asc' ? cmp : -cmp;
    });
  }

  get pagedRows(): any[] {
    const start = (this.page - 1) * this.pageSize;
    return this.sortedRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number { return Math.ceil(this.rows.length / this.pageSize); }

  get pageNumbers(): number[] {
    const t = this.totalPages;
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
    if (this.page <= 4)      return [1, 2, 3, 4, 5, -1, t];
    if (this.page >= t - 3)  return [1, -1, t - 4, t - 3, t - 2, t - 1, t];
    return [1, -1, this.page - 1, this.page, this.page + 1, -1, t];
  }

  /* ── OEE figures: written and coloured as on every Reports tab (shared/report-value) ── */
  isOeeCol(key: string): boolean {
    return ['availability', 'performance', 'quality', 'oee'].includes(key);
  }
  readonly pctText = pctText;
  readonly pctTone = pctTone;

  /* ── export ──
     CSV and Excel are both built by the server from the screen's filters,
     columns and order — so the two files are the same report, and the whole
     range, not one day (the Excel was the first day only). A large one is
     emailed instead; the message says so. */
  private exportBuilt(format: 'csv' | 'xlsx'): void {
    if (this.exporting) return;
    this.exporting = format;
    this.cdr.markForCheck();
    const f = this.filters;
    this.svc.exportFile(this.rt, format, f, this.activeColumns.map(c => c.key), this.sortCol || undefined, this.sortDir)
      .subscribe({
        next: async res => {
          const message = await saveOrMessage(res, `${this.activeTab}_${f.date_from}_to_${f.date_to}.${format}`);
          this.exporting = '';
          if (message) this.showNotice(message);
          this.cdr.markForCheck();
        },
        error: async err => {
          this.exporting = '';
          this.toast.error(await downloadError(err, 'The report could not be downloaded. Try again.'));
          this.cdr.markForCheck();
        }
      });
  }

  /* ── KPI cards ── */
  private buildKpis(tab: ReportType, s: any): KpiCard[] {
    if (tab === 'production') return [
      { label: 'Total Parts',  value: qty(s.total_parts ?? 0, 0), unit: 'pcs', icon: 'inventory_2', color: 'blue',   help: 'produced' },
      { label: 'Run Hours',    value: s.run_hours       ?? '0', unit: 'hrs', icon: 'play_arrow',  color: 'green',  help: 'run_hours' },
      { label: 'Total Energy', value: qty(s.total_energy ?? 0, 2), unit: 'kWh', icon: 'bolt',        color: 'yellow', help: 'energy_total' },
      { label: 'Efficiency',   value: s.efficiency_pct  ?? '0', unit: '%',   icon: 'speed',       color: 'purple', help: 'efficiency' },
    ];
    return [
      { label: 'Avg Availability', value: s.avg_availability ?? '0', unit: '%', icon: 'schedule', color: 'blue',   help: 'avg_availability' },
      { label: 'Avg Performance',  value: s.avg_performance  ?? '0', unit: '%', icon: 'speed',    color: 'green',  help: 'avg_performance' },
      { label: 'Avg Quality',      value: s.avg_quality      ?? '0', unit: '%', icon: 'verified', color: 'yellow', help: 'avg_quality' },
      { label: 'Avg OEE',          value: s.avg_oee          ?? '0', unit: '%', icon: 'insights', color: 'purple', help: 'avg_oee' },
    ];
  }

  /* ── helpers ── */
  minOf(a: number, b: number): number { return Math.min(a, b); }

  private todayStr(): string {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  nowDisplay(): string {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }
}
