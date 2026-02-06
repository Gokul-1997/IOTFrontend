import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlantService } from './plant.service';

@Component({
  standalone: true,
  selector: 'app-plant-list',
  imports: [CommonModule],
  templateUrl: './plant-list.component.html',
  styleUrls: ['./plant-list.component.scss']
})
export class PlantListComponent implements OnInit {
  plants: any[] = [];

  constructor(private service: PlantService) {}

  ngOnInit() {
    this.service.getAll().subscribe(res => (this.plants = res));
  }
}
