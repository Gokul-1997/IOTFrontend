import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { MatIconModule } from '@angular/material/icon';
import { CncMachineComponent } from '../../shared/cnc-machine/cnc-machine.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, MatIconModule, CncMachineComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  /* the demo machine beside the form: runs, pauses briefly, runs again */
  demoStatus: 'RUNNING' | 'IDLE' = 'RUNNING';
  demoLoad = 72;
  demoParts = 318;
  private demoTick = 0;
  private demoTimer?: ReturnType<typeof setInterval>;

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

    this.demoTimer = setInterval(() => {
      this.demoTick = (this.demoTick + 1) % 14;
      this.demoStatus = this.demoTick >= 11 ? 'IDLE' : 'RUNNING';
      if (this.demoStatus === 'RUNNING') {
        this.demoLoad = Math.max(48, Math.min(91, this.demoLoad + Math.round((Math.random() - .5) * 12)));
        if (this.demoTick % 3 === 0) this.demoParts += 1;
      }
      this.cdr.markForCheck();
    }, 1200);
  }

  ngOnDestroy(): void { clearInterval(this.demoTimer); }

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
