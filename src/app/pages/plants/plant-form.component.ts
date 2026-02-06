import { Component } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PlantService } from './plant.service';

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './plant-form.component.html',
  styleUrls: ['./plant-form.component.scss']
})
export class PlantFormComponent {
  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: PlantService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.form = this.fb.group({
      plant_code: ['', Validators.required],
      plant_name: ['', Validators.required],
      location: ['']
    });
  }
  save() {
    if (this.form.invalid) return;

    this.service.create(this.form.value).subscribe(() => {
      this.router.navigate(['/plants']);
    });
  }
}
