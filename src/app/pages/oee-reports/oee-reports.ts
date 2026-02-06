import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OeeReportsService } from './oee.service';

@Component({
  standalone: true,
  selector: 'app-oee-reports',
  imports: [CommonModule, FormsModule],
  templateUrl: './oee-reports.html'
})
export class OeeReportsComponent implements OnInit {

  machines: any[] = [];
  shifts: any[] = [];
  rows: any[] = [];

  selectedMachine!: number;
  selectedShift!: number;

  page = 1;
  limit = 6;
  total = 0;

  sort = 'shift_date';
  order: 'asc' | 'desc' = 'desc';

  constructor(private service: OeeReportsService) { }

  ngOnInit() {
    this.loadMeta();
  }
  loadMeta() {
    this.service.getMeta().subscribe(res => {
      this.machines = res.data.machines ?? [];
      this.shifts = res.data.shifts ?? [];

      if (!this.machines.length || !this.shifts.length) return;

      this.selectedMachine = this.machines[0].id;
      this.selectedShift = this.shifts[0].id;

      this.page = 1;
      this.loadReports();
    });
  }

  onFilterChange() {
    if (!this.selectedMachine || !this.selectedShift) return;

    this.page = 1;        // 🔥 VERY IMPORTANT
    this.loadReports();
  }

  loadReports() {
    this.service.getReports({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      page: this.page,
      limit: this.limit,
      sort: this.sort,
      order: this.order
    }).subscribe(res => {
      this.rows = res.data ?? [];
      this.total = res.total ?? 0;
    });
  }




  changeSort(col: string) {
    if (this.sort === col) {
      this.order = this.order === 'asc' ? 'desc' : 'asc';
    } else {
      this.sort = col;
      this.order = 'asc';
    }
    this.loadReports();
  }

  totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }
}
