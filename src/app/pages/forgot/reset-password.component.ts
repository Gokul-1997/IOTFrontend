import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy } from "@angular/core";
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm_password')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
}

@Component({
  standalone: true,
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnDestroy {

  token!: string;
  isSetup = false;
  loading = false;
  private redirectTimer?: ReturnType<typeof setTimeout>;
  message = '';
  success = false;
  showPassword = false;
  showConfirm = false;

  form = new FormGroup({
    password: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirm_password: new FormControl('', [Validators.required])
  }, { validators: passwordMatchValidator });

  constructor(
    private route: ActivatedRoute,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.token = this.route.snapshot.params['token'];
    this.isSetup = this.route.snapshot.queryParamMap.get('mode') === 'setup';
  }

  ngOnDestroy() {
    clearTimeout(this.redirectTimer);
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading || this.success) return;
    this.loading = true;
    this.message = '';

    this.auth.resetPassword(this.token, this.form.value.password!)
      .subscribe({
        next: () => {
          this.loading = false;
          this.message = this.isSetup
            ? 'Your password is set. Redirecting to sign in...'
            : 'Your password has been reset. Redirecting to sign in...';
          this.success = true;
          /* Zoneless: without this the confirmation never appears and the
             user is redirected from a page that still looks like a form. */
          this.cdr.markForCheck();
          this.redirectTimer = setTimeout(() => this.router.navigate(['/login']), 2000);
        },
        error: (err) => {
          this.loading = false;
          this.message = err.error?.message || 'Unable to save your password. Please try again.';
          this.cdr.markForCheck();
        }
      });
  }
}
