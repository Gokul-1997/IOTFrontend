import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ShiftsService } from './shifts.service';

@Component({
  standalone: true,
  selector: 'app-shift-form',
  templateUrl: './shift-form.component.html',
  imports: [CommonModule, ReactiveFormsModule]
})
export class ShiftFormComponent implements OnInit {

  @Input() data: any = null;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  form!: FormGroup;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private service: ShiftsService
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      shift_code: ['', Validators.required],
      shift_name: [''],
      start_time: ['', Validators.required],
      end_time: ['', Validators.required],
      break_minutes: [0, [Validators.required, Validators.min(0)]],
      is_active: [true]
    });

    if (this.data) {
      this.form.patchValue(this.data);
    }
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    const req$ = this.data
      ? this.service.update(this.data.id, this.form.value)
      : this.service.create(this.form.value);

    req$.subscribe(() => {
      this.saving = false;
      this.saved.emit();
    });
  }

  cancel() {
    this.close.emit();
  }
}
