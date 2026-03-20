import { Component, Inject, OnInit } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ShiftsService } from './shifts.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-shift-form',
  templateUrl: './shift-form.component.html',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    CommonModule
  ]
})
export class ShiftFormComponent implements OnInit {

  saving = false;
  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: ShiftsService,
    private dialogRef: MatDialogRef<ShiftFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) { }

  ngOnInit() {

    this.form = this.fb.group({
      shift_code: ['', Validators.required],
      shift_name: [''],
      start_time: ['', Validators.required],
      end_time: ['', Validators.required],
      break_minutes: [0, [Validators.required, Validators.min(0)]]
}, { validators: this.shiftValidator });

    if (this.data) {
      this.form.patchValue({
        ...this.data,
        start_time: this.data.start_time?.slice(0,5),
        end_time: this.data.end_time?.slice(0,5)
      });
    }
  }

  /* ================= SHIFT VALIDATION ================= */

shiftValidator = (group: AbstractControl): ValidationErrors | null => {

  const start = group.get('start_time')?.value;
  const end = group.get('end_time')?.value;
  const breakMin = Number(group.get('break_minutes')?.value || 0);

  if (!start || !end) return null;

  const startMin = this.timeToMinutes(start);
  const endMin = this.timeToMinutes(end);

  let duration;

  if (startMin === endMin) {
    duration = 1440; // 24h shift
  } else if (endMin > startMin) {
    duration = endMin - startMin;
  } else {
    duration = (1440 - startMin) + endMin;
  }

  if (duration <= 0 || duration > 1440) {
    return { invalidDuration: true };
  }

  if (breakMin >= duration) {
    return { invalidBreak: true };
  }

  return null;
};

private timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
  /* ================= SUBMIT ================= */

  submit() {

    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving = true;

    const payload = {
      ...this.form.value,
      break_minutes: Number(this.form.value.break_minutes)
    };

    if (this.data) {

      const changed: any = {};

      Object.keys(payload).forEach(key => {
        if (payload[key] !== this.data[key]) {
          changed[key] = payload[key];
        }
      });

      if (Object.keys(changed).length === 0) {
        this.saving = false;
        this.dialogRef.close();
        return;
      }

      this.service.update(this.data.id, changed)
        .subscribe({
          next: () => {
            this.saving = false;
            this.dialogRef.close(true);
          },
          error: () => this.saving = false
        });

    } else {

      this.service.create(payload)
        .subscribe({
          next: () => {
            this.saving = false;
            this.dialogRef.close(true);
          },
          error: () => this.saving = false
        });
    }
  }

  cancel() {
    this.dialogRef.close();
  }

  openTimePicker(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.showPicker) {
      input.showPicker();
    }
  }
}