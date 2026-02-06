import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlantsService } from './plants.service';

@Component({
  standalone: true,
  selector: 'app-plant-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './plant-form.component.html'
})
export class PlantFormComponent {

  @Input() data: any;
  @Output() close = new EventEmitter();
  @Output() saved = new EventEmitter();

  form: any = {
    plant_code: '',
    plant_name: '',
    location: ''
  };

  constructor(private service: PlantsService) {}

  ngOnInit() {
    if (this.data) this.form = { ...this.data };
  }

  save() {
    const req = this.data
      ? this.service.updatePlant(this.data.id, this.form)
      : this.service.createPlant(this.form);

    req.subscribe(() => this.saved.emit());
  }
}
