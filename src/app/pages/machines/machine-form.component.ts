import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormsModule } from '@angular/forms';   // ✅ ADD THIS
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MachineService } from './machine.service';

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './machine-form.component.html',
  styleUrls: ['./machine-form.component.scss']
})
export class MachineFormComponent {

  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: MachineService,
    private router: Router
  ) { }
  ngOnInit(): void {
    this.form = this.fb.group({
      machine_code: ['', Validators.required],
      machine_name: ['', Validators.required],
      axis_model: [''],
      controller_model: [''],
      machine_year: ['']
    });
  }
  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.service.create(this.form.value).subscribe({
      next: () => {
        this.router.navigate(['/machines']);
      },
      error: () => {
        this.saving = false;
        alert('Failed to create machine');
      }
    });
  }
}
