import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';

import { JobService } from './job.service';
import { JobCreateModalComponent } from './job-create-modal.component';

@Component({
  standalone: true,
  selector: 'app-job-list',
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    JobCreateModalComponent
  ],
  templateUrl: './job-list.component.html'
})
export class JobListComponent implements OnInit {

  displayedColumns: string[] = [
    'machine',
    'part',
    'target',
    'action'
  ];

  dataSource = new MatTableDataSource<any>();

  showModal = false;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private service: JobService) {}

  ngOnInit() {
    this.load();
  }

  /* LOAD JOBS */

  load() {

    this.service.getJobs().subscribe((res: any) => {

      const data = res.data || [];

      this.dataSource.data = data;

      if (this.paginator) {
        this.dataSource.paginator = this.paginator;
      }

      if (this.sort) {
        this.dataSource.sort = this.sort;
      }

    });

  }

  /* CREATE JOB */

  openCreate() {
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.load();
  }

  /* STOP JOB */

  stop(machine_id: number) {

    this.service.stopJob(machine_id).subscribe(() => {

      this.load();

    });

  }

}
