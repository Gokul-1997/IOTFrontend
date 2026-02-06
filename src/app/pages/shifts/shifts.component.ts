import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { ShiftsService } from './shifts.service';
import { ShiftFormComponent } from './shift-form.component';

@Component({
  standalone: true,
  selector: 'app-shifts',
  templateUrl: './shifts.component.html',
  imports: [
    CommonModule,
    FormsModule,

    MatTableModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,

    ShiftFormComponent
  ]
})
export class ShiftsComponent implements OnInit {

  rows: any[] = [];
  filteredRows: any[] = [];

  displayedColumns = [
    'shift_code',
    'shift_name',
    'time',
    'break_minutes',
    'is_active',
    'actions'
  ];

  search = '';

  showForm = false;
  editData: any = null;

  constructor(private service: ShiftsService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.service.getShifts().subscribe(res => {
      this.rows = res.data;
      this.filteredRows = [...this.rows];
    });
  }

  applyFilter() {
    const val = this.search.toLowerCase();

    this.filteredRows = this.rows.filter(r =>
      r.shift_code.toLowerCase().includes(val) ||
      (r.shift_name || '').toLowerCase().includes(val)
    );
  }

openCreate() {
  this.editData = null;
  this.showForm = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });  }

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
