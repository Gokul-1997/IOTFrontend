import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';

import { OperatorService } from './operator.service';
import { OperatorFormComponent } from './operator-form.component';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-operators',
  templateUrl: './operators.component.html',
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatInputModule,
    MatTooltipModule
  ]
})
export class OperatorsComponent implements OnInit {

  displayedColumns = ['operator_code', 'operator_name', 'shift', 'machines', 'actions'];

  dataSource = new MatTableDataSource<any>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  deleteTarget: any = null;
  deleting = false;

  constructor(
    private service: OperatorService,
    private dialog: MatDialog,
    private toast: ToastService
  ) {}

  ngOnInit() { this.load(); }

  load() {
    this.service.getAll().subscribe((res: any) => {
      this.dataSource.data = res.data || res;
      setTimeout(() => {
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
      });
    });
  }

  applyFilter(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.dataSource.filter = value.trim().toLowerCase();
  }

  openCreate() {
    const ref = this.dialog.open(OperatorFormComponent, { width: '520px', autoFocus: false });
    ref.afterClosed().subscribe(saved => {
      if (saved) {
        this.load();
        this.toast.success('Operator created successfully');
      }
    });
  }

  openEdit(row: any) {
    this.service.getById(row.id).subscribe(res => {
      const ref = this.dialog.open(OperatorFormComponent, {
        width: '520px',
        autoFocus: false,
        data: res.data
      });
      ref.afterClosed().subscribe(saved => {
        if (saved) {
          this.load();
          this.toast.success('Operator updated successfully');
        }
      });
    });
  }

  formatTime(time: string): string {
    if (!time) return '--';
    const [hour, minute] = time.split(':').map(Number);
    const h = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

  confirmDelete(row: any) {
    this.deleteTarget = row;
  }

  cancelDelete() {
    this.deleteTarget = null;
    this.deleting = false;
  }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting = true;

    this.service.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting = false;
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
