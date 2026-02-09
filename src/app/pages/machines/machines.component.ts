import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MachinesService } from './machines.service';
import { MachineFormComponent } from './machine-form.component';

// Table Materials
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  standalone: true,
  selector: 'app-machines',
  imports: [CommonModule, FormsModule, MachineFormComponent, MatTableModule, MatPaginatorModule, MatSortModule, MatButtonModule, MatIconModule, MatInputModule, MatSlideToggleModule, MatProgressSpinnerModule],
  templateUrl: './machines.component.html'
})
export class MachinesComponent implements OnInit {

  rows: any[] = [];
  displayedColumns = [
    'machine_name',
    'axis_model',
    'controller_model',
    'machine_year',
    'is_active',
    'actions'
  ];

  search = '';
  page = 1;
  limit = 10;
  total = 0;

  sortBy = 'id';
  sortDir: 'asc' | 'desc' = 'desc';

  showForm = false;
  editData: any = null;

  constructor(private service: MachinesService,private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.service.getMachines({
      search: this.search,
      page: this.page,
      limit: this.limit,
      sortBy: this.sortBy,
      sortDir: this.sortDir
    }).subscribe(res => {
      this.rows = res.data;
      this.total = res.total;
       this.cdr.markForCheck(); 
    });
  }

  onSearch() {
    this.page = 1;
    this.load();
  }

  onSort(e: any) {
    this.sortBy = e.active;
    this.sortDir = e.direction || 'asc';
    this.load();
  }

  onPage(e: any) {
    this.page = e.pageIndex + 1;
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
      .subscribe(() => row.is_active = !row.is_active);
  }

  onSaved() {
    this.showForm = false;
    this.load();
  }
}
