import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { OperatorService } from '../operators/operator.service';
import { ShiftsService } from '../shifts/shifts.service';
import { AssignmentService } from './assignment.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-operator-shift',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './operator-shift.component.html',
  styleUrls: ['./operator-shift.component.scss']
})
export class OperatorShiftComponent implements OnInit {

  operators: any[] = [];
  shifts: any[] = [];
  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private operatorService: OperatorService,
    private shiftService: ShiftsService,
    private assignmentService: AssignmentService,
    public auth: AuthService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.form = this.fb.group({
      operator_id: ['', Validators.required],
      shift_id: ['', Validators.required],
      effective_from: ['', Validators.required]
    });
  /* Zoneless: an HTTP response resolving does not schedule a render, so a
     callback that changes what is on screen has to say so itself. */
    /* Both APIs answer { data: [...] }. The whole object was used as the list,
       so the dropdowns were empty and Angular threw NG0900 trying to loop over
       it. Operators are paged: ask for all of them. */
    this.operatorService.getAll({ limit: 500 }).subscribe((d: any) => {
      this.operators = Array.isArray(d) ? d : (d?.data || []);
      this.cdr.markForCheck();
    });
    this.shiftService.getShifts().subscribe((d: any) => {
      this.shifts = Array.isArray(d) ? d : (d?.data || []);
      this.cdr.markForCheck();
    });
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.assignmentService.assignOperatorShift(this.form.value).subscribe({
      next: () => {
        this.saving = false;
        alert('Operator assigned to shift');
        this.form.reset();
        this.cdr.markForCheck();
      },
      error: () => {
        this.saving = false;
        alert('Assignment failed');
        this.cdr.markForCheck();
      }
    });
  }
}
