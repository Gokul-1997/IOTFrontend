import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { OperatorService } from './operator.service';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-operator-form',
  templateUrl: './operator-form.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,

    // 🔹 Material modules (ALL REQUIRED)
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,        // ✅ REQUIRED for mat-select + mat-option
    MatSlideToggleModule    // ✅ REQUIRED for slide toggle

  ]
})
export class OperatorFormComponent implements OnInit {

  form!: FormGroup;
  shifts: any[] = [];
  machines: any[] = [];
  saving = false;

  constructor(
    private fb: FormBuilder,
    private service: OperatorService,
    private dialogRef: MatDialogRef<OperatorFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) { }

ngOnInit() {

  this.form = this.fb.group({
    operator_code: ['', Validators.required],
    operator_name: ['', Validators.required],
    skill_level: [''],
    shift_id: [null, Validators.required],
    machine_ids: [[]],
    is_active: [true]
  });

  this.loadMasters();
}

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    if (this.data) {

      const changed: any = {};

      Object.keys(this.form.controls).forEach(key => {
        const newValue = this.form.get(key)?.value;
        const oldValue = this.data[key];

        if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
          changed[key] = newValue;
        }
      });

      if (Object.keys(changed).length === 0) {
        this.dialogRef.close();
        return;
      }

      this.service.update(this.data.id, changed).subscribe(() => {
        this.saving = false;
        this.dialogRef.close(true);
      });

    } else {

      this.service.create(this.form.value).subscribe(() => {
        this.saving = false;
        this.dialogRef.close(true);
      });
    }
  }
loadMasters() {

  this.service.getShifts().subscribe((res: any) => {
    this.shifts = res.data;

    this.service.getMachines().subscribe((res2: any) => {
      this.machines = res2.data;

      // 🔥 IMPORTANT — patch AFTER both loaded
      if (this.data) {
        this.form.patchValue({
          operator_code: this.data.operator_code,
          operator_name: this.data.operator_name,
          skill_level: this.data.skill_level,
          shift_id: Number(this.data.shift_id),
          machine_ids: this.data.machine_ids || [],
          is_active: this.data.is_active
        });
      }
    });
  });
}




  cancel() {
    this.dialogRef.close();
  }
}
