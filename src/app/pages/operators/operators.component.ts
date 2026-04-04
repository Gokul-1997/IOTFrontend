import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OperatorService } from './operator.service';
import { OperatorFormComponent } from './operator-form.component';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-operators',
  templateUrl: './operators.component.html',
  styleUrl: './operators.component.scss',
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatSlideToggleModule,
    MatInputModule, MatTooltipModule, MatProgressSpinnerModule,
    OperatorFormComponent
  ]
})
export class OperatorsComponent implements OnInit, OnDestroy {

  displayedColumns = ['index', 'operator_code', 'operator_name', 'shift', 'machines', 'actions'];
  dataSource       = new MatTableDataSource<any>([]);

  loading       = false;
  search        = '';
  total         = 0;

  showModal     = false;
  modalData: any = null;
  deleteTarget: any = null;
  deleting      = false;

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: OperatorService,
    private toast:   ToastService,
    private cdr:     ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(val => {
      this.dataSource.filter = val.trim().toLowerCase();
    });

    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loading = true;
    this.service.getAll().subscribe({
      next: (res: any) => {
        this.dataSource.data = res.data || res;
        this.total           = this.dataSource.data.length;
        this.loading         = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; }
    });
  }

  onSearchInput() { this.searchSubject.next(this.search); }

  openCreate() { this.modalData = null; this.showModal = true; }

  openEdit(row: any) {
    this.service.getById(row.id).subscribe(res => {
      this.modalData = res.data;
      this.showModal = true;
      this.cdr.detectChanges();
    });
  }

  onSaved() {
    const wasEdit = !!this.modalData;
    this.showModal = false;
    this.load();
    this.toast.success(wasEdit ? 'Operator updated successfully' : 'Operator created successfully');
    this.modalData = null;
  }

  onClose() { this.showModal = false; this.modalData = null; }

  formatTime(time: string): string {
    if (!time) return '--';
    const [hour, minute] = time.split(':').map(Number);
    const h    = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

  confirmDelete(row: any) { this.deleteTarget = row; }
  cancelDelete()          { this.deleteTarget = null; this.deleting = false; }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.service.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
        this.toast.success('Operator deleted successfully');
      },
      error: (err: any) => {
        this.deleting = false;
        this.toast.error(err?.error?.message || 'Delete failed. Try again.');
      }
    });
  }
}
