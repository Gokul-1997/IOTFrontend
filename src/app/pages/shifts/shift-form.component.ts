import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ShiftsService } from './shifts.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

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
    MatIconModule
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
      break_minutes: [0, [Validators.min(0)]]
    });
    if (this.data) {
      this.form.patchValue(this.data);
    }
  }

submit() {
  if (this.form.invalid) return;

  this.saving = true;

  if (this.data) {

    const changed: any = {};

    Object.keys(this.form.controls).forEach(key => {
      const newValue = this.form.get(key)?.value;
      const oldValue = this.data[key];

      // Compare values (stringify handles time comparison safely)
      if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        changed[key] = newValue;
      }
    });

    // Nothing changed → just close
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
        error: () => {
          this.saving = false;
        }
      });

  } else {

    this.service.create(this.form.value)
      .subscribe({
        next: () => {
          this.saving = false;
          this.dialogRef.close(true);
        },
        error: () => {
          this.saving = false;
        }
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
