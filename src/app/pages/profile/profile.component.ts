import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Every authenticated user's own account page.
 * Profile details are read-only and managed through administration.
 * Users can change their password in a separate dialog.
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
    .prof-help { margin: 1.5rem 0 0; color: var(--mexa-ink-3); font-size: .85rem; line-height: 1.5; }
    .prof-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
    .prof-retry { margin-top: .75rem; }
  `]
})
export class ProfileComponent implements OnInit {

  loading = true;
  errorMsg = '';
  profile: any = null;

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
