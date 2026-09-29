import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loading = false;
  error = '';
  form!: FormGroup;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private theme: ThemeService
  ) {}

  get isDark(): boolean { return this.theme.isDark(); }

  ngOnInit(): void {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    // why the last session ended, when the server ended it
    this.error = this.auth.takeSignedOutReason();
  }

  toggleDark(): void {
    this.theme.toggle();
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.error = '';

    this.auth.login(this.form.value)
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: () => this.router.navigate([this.auth.getFirstAccessibleRoute()]),
        error: err => {
          this.error = this.resolveError(err);
          this.cdr.detectChanges();
        }
      });
  }

  private resolveError(err: any): string {
    switch (err.status) {
      case 0: return 'Unable to reach the server. Check your internet connection.';
      case 401: return err.error?.message || 'Invalid email or password.';
      case 403:
        // the company is turned off, not this one account: say which
        if (err.error?.code === 'COMPANY_DISABLED') return err.error.message;
        return 'Your account has been deactivated. Please contact support.';
      case 429: return 'Too many login attempts. Please wait a moment and try again.';
      case 500:
      case 502:
      case 503: return 'Server error. Please try again later.';
      default: return err.error?.message || 'Login failed. Please try again.';
    }
  }
}
