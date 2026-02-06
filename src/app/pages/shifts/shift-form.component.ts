import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ShiftService } from './shift.service';

@Component({
  standalone: true,
  selector: 'app-shift-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './shift-form.component.html',
  styleUrls: ['./shift-form.component.scss']
})
export class ShiftFormComponent {

  saving = false;
  form!: FormGroup;
  
  constructor(
    private fb: FormBuilder,
    private service: ShiftService,
    private router: Router
  ) { }
  ngOnInit(): void {
    this.form = this.fb.group({
      shift_code: ['', Validators.required],
      shift_name: ['', Validators.required],
      start_time: ['', Validators.required], // HH:mm
      end_time: ['', Validators.required],   // HH:mm
      break_minutes: [0]
    });
  }
  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.service.create(this.form.value).subscribe({
      next: () => this.router.navigate(['/shifts']),
      error: () => {
        this.saving = false;
        alert('Failed to create shift');
      }
    });
  }
}
