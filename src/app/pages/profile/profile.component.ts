import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

/** The check the API makes (auth.service updateMyProfile), said before sending. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Every authenticated user's own account page.
 *
 * Before this existed there was no page here at all: the user-menu dropdown
 * held a name, an email and Sign Out. A MANAGER, SUPERVISOR or OPERATOR had
 * no way to see their own profile, correct their email, or change their own
 * password — GET/PUT /api/users/:id is ADMIN-tier only.
 *
 * The details are read on the page; Edit and Change password open the same
 * dialog as every other form in the app (they used to open in the page).
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styles: [`
    .prof-dl { display: grid; gap: 1rem 1.5rem; grid-template-columns: repeat(2, minmax(12rem, 1fr)); margin: 0; font-size: .9rem; }
    .prof-dl dt { color: var(--mexa-ink-3); font-size: .8rem; }
    .prof-dl dd { margin: .15rem 0 0; color: var(--mexa-ink); font-weight: 600; overflow-wrap: anywhere; }
    .prof-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
    .prof-retry { margin-top: .75rem; }
  `]
})
export class ProfileComponent implements OnInit {

  loading = true;
  errorMsg = '';
  profile: any = null;

  /* ── edit account details ── */
  editing = false;
  form = { email: '', mobile: '' };
  saving = false;
  saveErr = '';
  emailError = '';

  /* ── change password ── */
  showPassword = false;
  pwForm = { current_password: '', new_password: '', confirm_password: '' };
  changingPw = false;
  pwErr = '';

  constructor(private auth: AuthService, private toast: ToastService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    this.auth.getMyProfile().subscribe({
      next: (res: any) => {
        this.profile = res.data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMsg = err?.error?.message || 'Unable to load your profile.';
        this.cdr.markForCheck();
      }
    });
  }

  startEdit(): void {
    this.form = { email: this.profile.email || '', mobile: this.profile.mobile || '' };
    this.saveErr = '';
    this.emailError = '';
    this.editing = true;
  }

  cancelEdit(): void {
    this.editing = false;
    this.saveErr = '';
    this.emailError = '';
  }

  saveProfile(): void {
    if (this.saving) return;
    const email = this.form.email.trim();
    this.emailError = !email ? 'Enter your email address.'
      : !EMAIL.test(email) ? 'Enter a valid email address, like name@company.com.' : '';
    if (this.emailError) { document.getElementById('profEmail')?.focus(); return; }

    this.saving = true;
    this.saveErr = '';
    this.cdr.markForCheck();

    this.auth.updateMyProfile({ email, mobile: this.form.mobile.trim() }).subscribe({
      next: (res: any) => {
        this.saving = false;
        this.editing = false;
        this.profile = { ...this.profile, ...res.data };
        this.toast.success('Account details saved');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.saveErr = err?.error?.message || 'Could not save. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  openPassword(): void {
    this.pwForm = { current_password: '', new_password: '', confirm_password: '' };
    this.pwErr = '';
    this.showPassword = true;
  }

  closePassword(): void {
    this.showPassword = false;
    this.pwForm = { current_password: '', new_password: '', confirm_password: '' };
    this.pwErr = '';
  }

  changePassword(): void {
    if (this.changingPw) return;
    this.pwErr = '';

    if (!this.pwForm.current_password || !this.pwForm.new_password) {
      this.pwErr = 'Enter your current password and a new one.';
      return;
    }
    if (this.pwForm.new_password !== this.pwForm.confirm_password) {
      this.pwErr = 'New password and confirmation do not match.';
      return;
    }
    if (this.pwForm.new_password.length < 8) {
      this.pwErr = 'New password must be at least 8 characters.';
      return;
    }

    this.changingPw = true;
    this.cdr.markForCheck();

    this.auth.changeMyPassword(this.pwForm.current_password, this.pwForm.new_password).subscribe({
      next: () => {
        this.changingPw = false;
        this.closePassword();
        this.toast.success('Password changed');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.changingPw = false;
        this.pwErr = err?.error?.message || 'Could not change password. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  /** The role the header shows — the person's role, not the coarse
   *  user_type ("company_user" is every company account, admin included). */
  roleLabel(userType: string): string {
    const roles = this.auth.getRoles();
    if (userType === 'snt_super' || roles.includes('SNT_SUPER')) return 'S&T Super Admin';
    if (roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) return 'Company Admin';
    const raw = roles[0] || userType;
    if (!raw) return '--';
    return raw.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
}
