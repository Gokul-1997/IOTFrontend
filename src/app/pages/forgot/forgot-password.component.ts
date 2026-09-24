import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss']
})
export class ForgotPasswordComponent {
  loading = false;
  message = '';
  error = '';
  isDark = document.documentElement.classList.contains('dark');
  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email])
  });

  constructor(private auth: AuthService, private cdr: ChangeDetectorRef) {}

  toggleDark(): void {
    this.isDark = !this.isDark;
    document.documentElement.classList.toggle('dark', this.isDark);
    localStorage.setItem('theme', this.isDark ? 'dark' : 'light');
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.error = '';
    this.message = '';

    this.auth.forgotPassword(this.form.value.email!)
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res: any) => {
          this.message = res.message || 'Your reset request has been received.';
          this.cdr.detectChanges();
        },
        error: err => {
          this.error = err.error?.message || 'Unable to send a reset link. Please try again.';
          this.cdr.detectChanges();
        }
      });
  }
}
