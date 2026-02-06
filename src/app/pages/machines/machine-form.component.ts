import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MachinesService } from './machines.service';

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './machine-form.component.html'
})
export class MachineFormComponent implements OnInit {

@Input() data: any;
@Output() saved = new EventEmitter<void>();
@Output() close = new EventEmitter<void>();

  form: any = {
    machine_code: '',
    axis_model : '',
    machine_name: '',
    machine_year: '',
    controller_model: ''
  };

  constructor(private service: MachinesService) {}

  ngOnInit() {

    if (this.data) this.form = { ...this.data };
  }

  save() {
    const req = this.data
      ? this.service.update(this.data.id, this.form)
      : this.service.create(this.form);

    req.subscribe(() => this.saved.emit());
  }
}
