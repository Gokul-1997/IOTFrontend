import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';

import { OperatorService } from './operator.service';
import { OperatorFormComponent } from './operator-form.component';

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
    MatInputModule
  ]
})
export class OperatorsComponent implements OnInit {

  displayedColumns = [
    'operator_code',
    'operator_name',
    'shift',
    'machines',
    'actions'
  ];

  dataSource = new MatTableDataSource<any>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private service: OperatorService,
    private dialog: MatDialog
  ) { }

  ngOnInit() {
    this.load();
  }

  load() {
    this.service.getAll().subscribe((res: any) => {
      const data = res.data || res;
      this.dataSource.data = data;

      // attach paginator & sort AFTER data
      setTimeout(() => {
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
      });
    });
  }

  // 🔍 Global Search
  applyFilter(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.dataSource.filter = value.trim().toLowerCase();
  }

  openCreate() {
    const ref = this.dialog.open(OperatorFormComponent, {
      width: '520px',
      autoFocus: false
    });

    ref.afterClosed().subscribe(saved => {
      if (saved) this.load();
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
      if (saved) this.load();
    });
  });
}
}
