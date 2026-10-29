import { StoredImageDirective } from '../../shared/stored-image.directive';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MachinesService } from './machines.service';
import { MachineFormComponent } from './machine-form.component';
import { controllerTypeLabel } from './controller-types';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

import { StateComponent } from '../../shared/state/state.component';
import { MEXA_TABLE } from '../../shared/table/mexa-table';
import { BLANK, TableState } from '../../shared/table/table-state';

const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }, { value: BLANK, label: 'Not set' }];
@Component({
  standalone: true,
  selector: 'app-machines',
  imports: [StoredImageDirective,
    CommonModule, FormsModule, MachineFormComponent,
    MatTableModule, MatPaginatorModule, ...MEXA_TABLE,
    MatButtonModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, StateComponent
  ],
  templateUrl: './machines.component.html',
  styleUrl: './machines.component.scss'
})
export class MachinesComponent implements OnInit, OnDestroy {

  rows: any[]  = [];
  displayedColumns = [
    'index',
    'name',
    'machine_serial_no',
    'model',
    'controller',
    'ip',
    'spindle_rpm',
    'x_axis',
    'y_axis',
    'z_axis',
    'fourth_axis',
    'fifth_axis',
    'twin_spindle',
    'twin_table',
    'atc_tool_capacity',
    'mmc_no',
    'image_url',
    'api_key',
    'is_active',
    'actions'
  ];

  search   = '';
  page     = 1;
  limit    = 10;
  total    = 0;
  loading  = false;

  /** By name, its numbers as numbers (VMC - 2 before VMC - 10), as every machine list the API gives (29 Oct 2026). */
  /* The table's header (shared/table, 29 Oct 2026): sort any column, filter
     or search it — the API pages the machines, so it does both. In name
     order until a column is chosen. No Line filter: machines are picked by
     name (21 Oct 2026). */
  readonly machineTable = new TableState<any>([
    { key: 'line' },
    { key: 'machine' },
    { key: 'model' },
    { key: 'controller' },
    { key: 'ip' },
    { key: 'rpm' }, { key: 'x' }, { key: 'y' }, { key: 'z' }, { key: 'fourth' }, { key: 'fifth' },
    { key: 'twin_spindle', filter: 'list', options: YES_NO },
    { key: 'twin_table', filter: 'list', options: YES_NO },
    { key: 'atc' },
    { key: 'serial' },
    { key: 'status', filter: 'list', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }
  ], { mode: 'server', onChange: () => { this.page = 1; this.load(); } });

  showForm   = false;
  editData: any = null;

  deleteTarget: any = null;
  deleting     = false;
  deleteError  = '';

  private loadRequest?: Subscription;
  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: MachinesService,
    private cdr:     ChangeDetectorRef,
    private toast:   ToastService,
    public  auth:    AuthService,
    private route:   ActivatedRoute
  ) {}

  ngOnInit() {
    // opened for one machine (Program Transfer → "Change on the Machines page"): the list starts filtered to it
    this.search = (this.route.snapshot.queryParamMap.get('search') || '').slice(0, 100);

    // Debounce search so backend is only hit 400ms after user stops typing
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.page = 1;
      this.load();
    });

    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loadRequest?.unsubscribe();
    this.loading = true;
    this.loadRequest = this.service.getMachines({
      search:  this.search,
      page:    this.page,
      limit:   this.limit,
      ...this.machineTable.params()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.rows    = res.data;
        this.total   = res.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load machines.');
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput() {
    this.searchSubject.next(this.search);
  }


  onPage(e: any) {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.load();
  }

  openCreate() {
    this.editData = null;
    this.showForm = true;
  }

  openEdit(row: any) {
    this.editData = row;
    this.showForm = true;
  }

  toggle(row: any) {
    this.service.toggle(row.id, !row.is_active)
      .subscribe(() => {
        row.is_active = !row.is_active;
        this.cdr.markForCheck();
      });
  }

  onSaved() {
    this.showForm = false;
    this.load();
    this.toast.success(this.editData ? 'Machine updated successfully' : 'Machine created successfully');
  }

  confirmDelete(row: any) {
    this.deleteTarget = row;
    this.deleteError  = '';
  }

  cancelDelete() {
    this.deleteTarget = null;
    this.deleteError  = '';
    this.deleting     = false;
  }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting    = true;
    this.deleteError = '';

    this.service.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
        this.toast.success('Machine deleted successfully');
      },
      error: (err: any) => {
        this.deleting    = false;
        this.deleteError = err?.error?.message || 'Delete failed. Try again.';
        this.toast.error(this.deleteError);
      }
    });
  }




  rowIndex(i: number): number {
    return (this.page - 1) * this.limit + i + 1;
  }

  /** The machine's IP as the gateway gets it: its own report, else the one typed on the form. */
  ipOf(r: { controller_ip?: string | null; ip_address?: string | null }): string {
    return r.controller_ip?.trim() || r.ip_address?.trim() || '—';
  }

  /** "Fanuc · FANUC 0i-MF": the controller type chosen, then the Controller text. */
  controllerText(r: { controller?: string | null; controller_type?: string | null }): string {
    return [controllerTypeLabel(r.controller_type), r.controller?.trim()].filter(Boolean).join(' · ') || '—';
  }

  copyApiKey(apiKey: string) {
    navigator.clipboard.writeText(apiKey).then(() => {
      this.toast.success('API Key copied to clipboard');
    }).catch(() => {
      this.toast.error('Failed to copy API Key');
    });
  }
}
