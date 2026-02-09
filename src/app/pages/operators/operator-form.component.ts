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
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      operator_code: ['', Validators.required],
      operator_name: ['', Validators.required],
      shift_id: [null, Validators.required],
      machine_ids: [[], Validators.required],
      is_active: [true]
    });

    this.loadMasters();
  }

 loadMasters() {
  this.service.getShifts().subscribe((res: any) => {
        console.log('Shifts:', res);

    this.shifts = res.data;     // ✅ IMPORTANT
  });

  this.service.getMachines().subscribe((res: any) => {
        console.log('Shifts:', res);

    this.machines = res.data;   // ✅ IMPORTANT
  });
}


  submit() {
    if (this.form.invalid) return;

    this.saving = true;
    this.service.create(this.form.value).subscribe(() => {
      this.saving = false;
      this.dialogRef.close(true);
    });
  }

  cancel() {
    this.dialogRef.close();
  }
}
