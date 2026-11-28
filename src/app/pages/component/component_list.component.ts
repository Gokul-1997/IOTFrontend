import { ChangeDetectorRef, Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, finalize, takeUntil } from 'rxjs/operators';

import { ComponentApi } from './component.api';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MEXA_TABLE } from '../../shared/table/mexa-table';
import { TableState } from '../../shared/table/table-state';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { MultiOption, MultiSelectComponent } from '../../shared/multi-select/multi-select.component';

const HMS = /^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
/** Not only spaces. */
const TEXT = /\S/;

@Component({
  selector: 'app-component-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, ...MEXA_TABLE,
    MatButtonModule, MatIconModule, MatInputModule,
    MatTooltipModule, MatProgressSpinnerModule,
    MultiSelectComponent
  ],
  templateUrl: './component_list.component.html',
  styleUrl: './component_list.component.scss'
})
export class ComponentList implements OnInit, OnDestroy {

  form!: FormGroup;

  displayedColumns = ['index', 'machine_serial_no', 'part_name', 'part_number', 'operation_number', 'cycle_time', 'target', 'multiplication_factor', 'actions'];

  components: any[] = [];
  machines: any[] = [];
  /** The machines to pick from, by name (one flat list, as every machine list). */
  machineOptions: MultiOption[] = [];

  page    = 1;
  limit   = 10;
  total   = 0;
  search  = '';
  loading = false;

  showModal  = false;
  editing    = false;
  editingId: number | null = null;
  /** The machine of the component being edited: it stays on that machine. */
  editingMachine = '';
  saving     = false;
  /** Why the last save did not go through, in the dialog until the next try. */
  saveError  = '';

  deleteTarget: any  = null;
  deleting           = false;

  private loadRequest?: Subscription;
  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private fb:            FormBuilder,
    private api:           ComponentApi,
    private cdr:           ChangeDetectorRef,
    public auth:           AuthService,
    private toast:         ToastService
  ) {}

  /**
   * Show an error once the user has left the field, not while typing.
   * Matches the shared dialog behaviour (see shared/dialog-form.base.ts);
   * this is a page component rather than a dialog component, so it keeps
   * its own copy instead of extending that base.
   */
  invalid(name: string): boolean {
    const c = this.form?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  /** Escape closes whichever overlay is open, as it does everywhere else. */
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.deleteTarget) { this.cancelDelete(); return; }
    if (this.showModal)    { this.closeModal(); }
  }

  ngOnInit() {
    this.initForm();
    this.loadMachines();

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

  loadMachines() {
    this.api.getMachines().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.machines = res.data || [];
        this.machineOptions = this.machines.map((m: any) => ({ value: m.id, label: m.machine_serial_no }));
        this.cdr.markForCheck();
      },
      error: () => this.toast.error('Could not load the machines. Reload the page to add a component.')
    });
  }

  /* One part on many machines (28 Nov 2026, the user: "in component entry I
     need to select multiple machines"): machine_ids makes one component per
     machine. The part number is required, as the API has always required it
     (the form showed it as optional and the save failed without a word). */
  initForm() {
    this.form = this.fb.group({
      machine_ids:           [[] as number[], Validators.required],
      part_name:             ['', [Validators.required, Validators.pattern(TEXT), Validators.maxLength(100)]],
      part_number:           ['', [Validators.required, Validators.pattern(TEXT), Validators.maxLength(50)]],
      operation_number:      [''],
      cycle_time:            ['', [Validators.required, Validators.pattern(HMS)]],
      target:                [null as number | null, [Validators.required, Validators.min(1)]],
      multiplication_factor: [1]
    });
  }

  /** The add button says what it will do: one component, or one on each machine. */
  get addLabel(): string {
    const n = (this.form.get('machine_ids')?.value || []).length;
    return n > 1 ? `Add to ${n} machines` : 'Add component';
  }

  /* The table's header (shared/table, 29 Oct 2026): the API pages the
     components, so it sorts and filters them. Machines picked by name. */
  readonly componentTable = new TableState<any>([
    { key: 'machine', filter: 'list', options: () => (this.machines || []).map((m: any) => ({ value: m.machine_serial_no, label: m.machine_serial_no })) },
    { key: 'part_name' }, { key: 'part_number' }, { key: 'operation' },
    { key: 'cycle_time' }, { key: 'target' }, { key: 'factor' }
  ], { mode: 'server', onChange: () => { this.page = 1; this.load(); } });

  load() {
    this.loadRequest?.unsubscribe();
    this.loading = true;
    this.loadRequest = this.api.list(this.page, this.limit, this.search, this.componentTable.params()).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.components = res.data;
        this.total      = res.meta.total;
        this.loading    = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
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

  rowIndex(i: number) {
    return (this.page - 1) * this.limit + i + 1;
  }

  formatCycleTimeTable(t: any): string {
    if (!t) return '00:00:00';
    const h = String(t.hours   ?? 0).padStart(2, '0');
    const m = String(t.minutes ?? 0).padStart(2, '0');
    const s = String(t.seconds ?? 0).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  formatCycleTime(event: any) {
    let value = event.target.value.replace(/\D/g, '');
    if (value.length > 6) value = value.substring(0, 6);
    if (value.length >= 5)      value = value.replace(/^(\d{2})(\d{2})(\d{1,2})$/, '$1:$2:$3');
    else if (value.length >= 3) value = value.replace(/^(\d{2})(\d{1,2})$/, '$1:$2');
    this.form.patchValue({ cycle_time: value }, { emitEvent: false });
  }

  openModal() {
    this.editing        = false;
    this.editingId      = null;
    this.editingMachine = '';
    this.saveError      = '';
    this.form.reset({ machine_ids: [], part_name: '', part_number: '', operation_number: '', cycle_time: '', target: null, multiplication_factor: 1 });
    this.form.get('machine_ids')!.enable({ emitEvent: false });
    this.showModal = true;
  }

  closeModal() {
    this.showModal  = false;
    this.editing    = false;
    this.editingId  = null;
    this.saveError  = '';
  }

  submit() {
    if (this.saving) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const part = {
      part_name: String(v.part_name).trim(),
      part_number: String(v.part_number).trim(),
      operation_number: String(v.operation_number ?? '').trim(),
      cycle_time: v.cycle_time,
      target: Number(v.target),
      multiplication_factor: Number(v.multiplication_factor) || 1
    };
    const editing = this.editing && this.editingId !== null;
    const machineIds: number[] = v.machine_ids || [];
    this.saving = true;
    this.saveError = '';
    // a component keeps its machine: an edit sends only the part
    const save = editing ? this.api.update(this.editingId!, part) : this.api.create({ ...part, machine_ids: machineIds });
    save.pipe(
      finalize(() => { this.saving = false; this.cdr.markForCheck(); }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res: any) => {
        this.toast.success(editing ? `${part.part_name} saved` : `${part.part_name} added to ${this.whereAdded(res, machineIds)}`);
        this.closeModal();
        this.load();
      },
      error: err => {
        this.saveError = this.errorText(err, editing ? 'Could not save the component.' : 'Could not add the component.');
        this.cdr.markForCheck();
      }
    });
  }

  edit(data: any) {
    this.editing        = true;
    this.editingId      = data.id;
    this.editingMachine = data.machine_serial_no || '';
    this.saveError      = '';
    this.form.reset({
      machine_ids: [data.machine_id],
      part_name: data.part_name ?? '',
      part_number: data.part_number ?? '',
      operation_number: data.operation_number ?? '',
      cycle_time: this.formatCycleTimeTable(data.cycle_time),
      target: data.target ?? null,
      multiplication_factor: data.multiplication_factor ?? 1
    });
    this.form.get('machine_ids')!.disable({ emitEvent: false });
    this.showModal = true;
  }

  /** "3 machines", or the one machine's name. */
  private whereAdded(res: any, machineIds: number[]): string {
    const count = Array.isArray(res?.data) ? res.data.length : machineIds.length;
    if (count === 1) return this.machines.find(m => m.id === machineIds[0])?.machine_serial_no || '1 machine';
    return `${count} machines`;
  }

  /** The API's own words: its list of problems, or its message; a plain line when the server cannot be reached. */
  private errorText(err: any, fallback: string): string {
    const body = err?.error;
    if (Array.isArray(body?.errors) && body.errors.length) return `${body.errors.join('. ')}.`;
    if (err?.status === 0) return 'The server could not be reached. Check the connection and try again.';
    return typeof body?.message === 'string' && body.message ? body.message : fallback;
  }

  confirmDelete(row: any) { this.deleteTarget = row; }
  cancelDelete()          { this.deleteTarget = null; this.deleting = false; }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.api.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
      },
      error: () => { this.deleting = false; }
    });
  }
}
