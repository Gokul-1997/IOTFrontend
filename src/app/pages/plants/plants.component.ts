import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlantsService } from './plants.service';
import { PlantFormComponent } from './plant-form.component';

@Component({
  standalone: true,
  selector: 'app-plants',
  imports: [CommonModule, FormsModule, PlantFormComponent],
  templateUrl: './plants.component.html'
})
export class PlantsComponent implements OnInit {

  rows: any[] = [];
  total = 0;
  page = 1;
  limit = 10;
  search = '';

  showForm = false;
  editData: any = null;

  constructor(private service: PlantsService) { }

  ngOnInit() {
    this.load();
  }

  load() {
    this.service.getPlants({
      page: this.page,
      limit: this.limit,
      search: this.search
    }).subscribe(res => {
      this.rows = res.data;
      this.total = res.total;
    });
  }

  openCreate() {
    this.editData = null;
    this.showForm = true;
  }

  openEdit(row: any) {
    this.editData = row;
    this.showForm = true;
  }

  onSaved() {
    this.showForm = false;
    this.load();
  }

  toggle(row: any) {
    this.service.toggleStatus(row.id, !row.is_active)
      .subscribe(() => row.is_active = !row.is_active);
  }

  prevPage() {
    if (this.page > 1) {
      this.page--;
      this.load();
    }
  }

  nextPage() {
    if (this.page < this.totalPages()) {
      this.page++;
      this.load();
    }
  }

  totalPages() {
    return Math.ceil(this.total / this.limit);
  }
}
