import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { ShiftsService } from './shifts.service';
import { MatDialog } from '@angular/material/dialog';
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
    MatSlideToggleModule,]
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

  editData: any = null;

  constructor(private service: ShiftsService, private dialog: MatDialog,private cdr: ChangeDetectorRef) { }

  ngOnInit() {
    this.load();
  }

  openCreate() {
    const dialogRef = this.dialog.open(ShiftFormComponent, {
      width: '420px',
      maxWidth: '95vw',
      autoFocus: false,        // ✅ VERY IMPORTANT
      restoreFocus: false,
      disableClose: true,
      data: null
    });

    dialogRef.afterClosed().subscribe(saved => {
      if (saved) this.load();
    });
  }

  openEdit(row: any) {
    const dialogRef = this.dialog.open(ShiftFormComponent, {
      width: '420px',
      disableClose: true,
      data: row
    });

    dialogRef.afterClosed().subscribe(saved => {
      if (saved) this.load();
    });
  }

  load() {
    this.service.getShifts().subscribe(res => {
      this.rows = res.data;
      this.filteredRows = [...this.rows];
             this.cdr.markForCheck(); 

    });
  }

  applyFilter() {
    const val = this.search.toLowerCase();

    this.filteredRows = this.rows.filter(r =>
      r.shift_code.toLowerCase().includes(val) ||
      (r.shift_name || '').toLowerCase().includes(val)
    );
  }



  toggle(row: any) {
    this.service.toggle(row.id, !row.is_active)
      .subscribe(() => row.is_active = !row.is_active);
  }

}
