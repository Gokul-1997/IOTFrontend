import { Component, DestroyRef, EventEmitter, Output, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogFormBase } from '../../shared/dialog-form.base';
import { JobService } from './job.service';

@Component({
  standalone: true,
  selector: 'app-job-create-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './job-create-modal.component.html'
})
export class JobCreateModalComponent extends DialogFormBase implements OnInit {

  @Output() close = new EventEmitter<boolean>();

  form: any = {
    machine_id:   '',
    component_id: '',
    job_start:    ''
  };

  machines:   any[] = [];
  components: any[] = [];
  saving    = false;
  error     = '';
  loadingComponents = false;
  private componentsRequest?: Subscription;
  private destroyRef = inject(DestroyRef);

  constructor(private service: JobService) { super(); }

  dismiss() { this.cancel(); }

  ngOnInit() {
    this.loadData();
    // Default job_start to now (local datetime-local format)
    const now = new Date();
    now.setSeconds(0, 0);
    this.form.job_start = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  loadData() {
    this.service.getAvailableMachines().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((res: any) => {
      this.machines = res.data || [];
      this.touch();
    });
  }

  onMachineChange() {
    this.componentsRequest?.unsubscribe();
    this.error = '';
    this.form.component_id = '';
    this.components = [];
    this.loadingComponents = !!this.form.machine_id;
    if (this.form.machine_id) {
      this.componentsRequest = this.service.getComponents(this.form.machine_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res: any) => { this.components = res.data || []; this.loadingComponents = false; this.touch(); },
        error: () => { this.loadingComponents = false; this.error = 'Could not load this machine’s components. Select it again to retry.'; this.touch(); }
      });
    }
  }

  save() {
    if (this.saving || this.loadingComponents) return;
    this.error = '';
    if (!this.form.machine_id)   { this.error = 'Please select a machine.';   return; }
    if (!this.form.component_id) { this.error = 'Please select a component.'; return; }
    if (!this.components.some(c => Number(c.id) === Number(this.form.component_id))) { this.error = 'Select a component belonging to this machine.'; return; }
    if (!this.form.job_start)    { this.error = 'Please enter job start time.'; return; }

    this.saving = true;
    this.service.startJob({ ...this.form }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving = false;
        this.touch();
        this.close.emit(true);
      },
      error: (err: any) => {
        this.saving = false;
        this.error  = err?.error?.message || 'Failed to start job. Try again.';
        /* Without this the button stays on "Saving…" and the reason the job
           was not started is never shown. */
        this.touch();
      }
    });
  }

  cancel() { this.close.emit(false); }
}
