import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { OperatorService } from '../operators/operator.service';
import { MachineService } from '../machines/machine.service';
import { AssignmentService } from './assignment.service';

@Component({
  standalone: true,
  selector: 'app-assignment',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './assignment.component.html',
  styleUrls: ['./assignment.component.scss']
})
export class AssignmentComponent implements OnInit {

  operators: any[] = [];
  machines: any[] = [];
  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private operatorService: OperatorService,
    private machineService: MachineService,
    private assignmentService: AssignmentService
  ) { }

  ngOnInit() {
    this.form = this.fb.group({
      operator_id: ['', Validators.required],
      machine_id: ['', Validators.required],
      assigned_from: ['', Validators.required]
    });
    this.operatorService.getAll().subscribe(d => this.operators = d);
    this.machineService.getAll().subscribe(d => this.machines = d);
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.assignmentService.assignOperatorMachine(this.form.value).subscribe({
      next: () => {
        this.saving = false;
        alert('Operator assigned to machine');
        this.form.reset();
      },
      error: () => {
        this.saving = false;
        alert('Assignment failed');
      }
    });
  }
}
