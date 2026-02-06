import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { OperatorService } from './operator.service';

@Component({
  standalone: true,
  selector: 'app-operator-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './operator-form.component.html',
  styleUrls: ['./operator-form.component.scss']
})
export class OperatorFormComponent {

  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: OperatorService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.form = this.fb.group({
      operator_code: ['', Validators.required],
      operator_name: ['', Validators.required],
      skill_level: ['']
    });
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.service.create(this.form.value).subscribe({
      next: () => this.router.navigate(['/operators']),
      error: () => {
        this.saving = false;
        alert('Failed to create operator');
      }
    });
  }
}
