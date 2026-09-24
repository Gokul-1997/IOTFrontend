import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy } from "@angular/core";
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";
import { finalize } from "rxjs";

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
  message = '';
  success = false;
  loading = false;
  showPassword = false;
  showConfirm = false;
  private redirectTimer?: ReturnType<typeof setTimeout>;

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
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading || this.success) return;
    this.loading = true;
    this.message = '';

    this.auth.resetPassword(this.token, this.form.value.password!)
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      }))
      .subscribe({
        next: (res: any) => {
          this.message = 'Password reset successful. Redirecting to login...';
          this.success = true;
          /* Zoneless: without this the confirmation never appears and the
             user is redirected from a page that still looks like a form. */
          this.cdr.markForCheck();
          this.redirectTimer = setTimeout(() => this.router.navigate(['/login']), 2000);
        },
        error: (err) => {
          this.message = err.error?.message || 'Reset failed';
          this.cdr.markForCheck();
        }
      });
  }

  ngOnDestroy(): void {
    if (this.redirectTimer) clearTimeout(this.redirectTimer);
  }
}
