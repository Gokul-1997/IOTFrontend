import { Component, Input, Output, EventEmitter, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { DialogFormBase } from '../../shared/dialog-form.base';
import { LinesService } from './lines.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-line-form',
  templateUrl: './line-form.component.html',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule]
})
export class LineFormComponent extends DialogFormBase implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  form!: FormGroup;
  saving = false;
  plants: any[] = [];
  loadingPlants = true;
  plantsError = '';
  private readonly destroyRef = inject(DestroyRef);
  readonly boundPlantId = inject(AuthService).getUser()?.plant_id ?? null;

  constructor(
    private fb: FormBuilder,
    private service: LinesService,
    private toast: ToastService
  ) { super(); }

  dismiss() { if (!this.saving) this.close.emit(); }

  ngOnInit() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      plant_id: [this.boundPlantId, Validators.required],
      is_active: [true]
    });

    if (this.data) {
      this.form.patchValue({
        name: this.data.name || '',
        plant_id: this.boundPlantId ?? (this.data.plant_id != null ? Number(this.data.plant_id) : null),
        is_active: this.data.is_active !== false
      });
    }
    this.loadPlants();
  }

  loadPlants() {
    this.loadingPlants = true; this.plantsError = '';
    this.service.getPlants().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.plants = res.data || []; this.loadingPlants = false;
        if (!this.form.value.plant_id && this.plants.length === 1) this.form.patchValue({ plant_id: this.plants[0].id });
        this.touch();
      },
      error: () => { this.loadingPlants = false; this.plantsError = 'Could not load plants. Retry before saving.'; this.touch(); }
    });
  }

  submit() {
    if (this.saving || this.loadingPlants || this.plantsError) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.focusFirstInvalid({ name: '#lineName', plant_id: '#linePlant' });
      return;
    }

    this.saving = true;
    const payload = this.form.value;

    if (this.data) {
      const changed: any = {};
      Object.keys(payload).forEach(key => {
        if (key === 'plant_id' ? Number(payload[key]) !== Number(this.data[key]) : payload[key] !== this.data[key]) changed[key] = payload[key];
      });

      if (Object.keys(changed).length === 0) {
        this.saving = false;
        this.close.emit();
        return;
      }

      this.service.updateLine(this.data.id, changed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.touch(); this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.touch();
          this.toast.error(err?.error?.message || 'Update failed. Try again.');
        }
      });
    } else {
      this.service.createLine(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.touch(); this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.touch();
          this.toast.error(err?.error?.message || 'Create failed. Try again.');
        }
      });
    }
  }
}
