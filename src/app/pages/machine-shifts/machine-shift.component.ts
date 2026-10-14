import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule
} from '@angular/forms';

import { MachinesService } from '../machines/machines.service';
import { ShiftsService } from '../shifts/shifts.service';
import { MachineShiftService } from './machine-shift.service';

@Component({
  standalone: true,
  selector: 'app-machine-shift',
  imports: [CommonModule, ReactiveFormsModule,FormsModule], // ✅ NO FormsModule
  templateUrl: './machine-shift.component.html',
  styleUrls: ['./machine-shift.component.scss']
})
export class MachineShiftComponent implements OnInit {

  machines: any[] = [];
  shifts: any[] = [];
  selectedShifts: number[] = [];
  loadingConfig = false;
  saving = false;
  error = '';
  saved = false;
  private configuredMachine: number | null = null;
  private configRequest?: Subscription;
  private destroyRef = inject(DestroyRef);
  get configReady() { return Number(this.form?.value.machine_id) === this.configuredMachine; }

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private machineService: MachinesService,
    private shiftService: ShiftsService,
    private machineShiftService: MachineShiftService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      machine_id: ['']
    });

    /* Zoneless: without markForCheck both dropdowns stay empty until an
       unrelated click forces a change-detection pass. */
    this.machineService.getAllForDropdown().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((res: any) => {
      this.machines = res.data || [];
      this.cdr.markForCheck();
    });
    this.shiftService.getShifts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => { this.shifts = d; this.cdr.markForCheck(); });
  }

  loadConfig() {
    this.configRequest?.unsubscribe();
    const machineId = Number(this.form.value.machine_id);
    this.selectedShifts = []; this.configuredMachine = null; this.error = ''; this.saved = false;
    this.loadingConfig = !!machineId;
    if (!machineId) { this.cdr.markForCheck(); return; }
    this.configRequest = this.machineShiftService.getByMachine(machineId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.selectedShifts = res.map((x: any) => Number(x.shift_id));
        this.configuredMachine = machineId; this.loadingConfig = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loadingConfig = false; this.error = 'Could not load this machine’s shifts. Select it again to retry.'; this.cdr.markForCheck(); }
    });
  }

  toggleShift(shiftId: number, checked: boolean) {
    if (checked) {
      if (!this.selectedShifts.includes(shiftId)) {
        this.selectedShifts.push(shiftId);
      }
    } else {
      this.selectedShifts = this.selectedShifts.filter(x => x !== shiftId);
    }
  }

  save() {
    const machineId = Number(this.form.value.machine_id);
    if (this.saving || this.loadingConfig || !machineId || machineId !== this.configuredMachine) return;
    this.saving = true; this.error = ''; this.saved = false;
    const payload = {
      machine_id: machineId,
      shift_ids: [...this.selectedShifts]
    };
    this.machineShiftService.save(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.saving = false; this.saved = true; this.cdr.markForCheck(); },
      error: () => { this.saving = false; this.error = 'Could not save the configuration. Please try again.'; this.cdr.markForCheck(); }
    });
  }
}
