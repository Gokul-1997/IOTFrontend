import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LucideAngularModule, User, Lock, ShieldCheck } from 'lucide-angular';

/**
 * Every authenticated user's own account page.
 *
 * Before this existed there was no page here at all: the user-menu dropdown
 * held a name, an email and Sign Out. A MANAGER, SUPERVISOR or OPERATOR had
 * no way to see their own profile, correct their email, or change their own
 * password — GET/PUT /api/users/:id is ADMIN-tier only.
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  templateUrl: './profile.component.html',
  styles: [`
    .prof-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); align-items: start; }
    .prof-stack { display: grid; gap: 1rem; }
    .prof-grid .mexa-card + .mexa-card, .prof-stack .mexa-card + .mexa-card { margin-top: 0; }
    .prof-dl { display: grid; gap: 1rem 1.5rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin: 0; font-size: .9rem; }
    .prof-dl dt { color: var(--mexa-ink-3); font-size: .8rem; }
    .prof-dl dd { margin: .15rem 0 0; color: var(--mexa-ink); font-weight: 600; overflow-wrap: anywhere; }
    .prof-form { display: grid; gap: .9rem; max-width: 26rem; }
    .prof-form > .ui-btn, .prof-form > .ui-btn-row { justify-self: start; }
    .prof-hint { margin: -.4rem 0 .9rem; }
    .prof-ok { color: #15803d; font-size: .85rem; margin: .5rem 0 0; }
    :host-context(.dark) .prof-ok { color: #6fdba0; }
    .prof-retry { margin-top: .75rem; }
  `]
})
export class ProfileComponent implements OnInit {

  loading = true;
  errorMsg = '';
  profile: any = null;
  activeTab: 'account' | 'password' | 'security' = 'account';
  /* ── edit profile ── */
  editing = false;
  form = { email: '', mobile: '' };
  saving = false;
  saveNote = '';
  saveErr = '';

  /* ── change password ── */
  pwForm = { current_password: '', new_password: '', confirm_password: '' };
  changingPw = false;
  pwNote = '';
  pwErr = '';

  constructor(private auth: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    this.auth.getMyProfile().subscribe({
      next: (res: any) => {
        this.profile = res.data;
        this.form = { email: this.profile.email || '', mobile: this.profile.mobile || '' };
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
    this.editing = true;
    this.saveNote = '';
    this.saveErr = '';
    this.form = { email: this.profile.email || '', mobile: this.profile.mobile || '' };
  }

  cancelEdit(): void {
    this.editing = false;
    this.saveErr = '';
  }

  saveProfile(): void {
    if (this.saving) return;
    this.saving = true;
    this.saveErr = '';
    this.saveNote = '';
    this.cdr.markForCheck();

    this.auth.updateMyProfile({ email: this.form.email.trim(), mobile: this.form.mobile.trim() }).subscribe({
      next: (res: any) => {
        this.saving = false;
        this.editing = false;
        this.saveNote = 'Profile updated.';
        this.profile = { ...this.profile, ...res.data };
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.saveErr = err?.error?.message || 'Could not save. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  changePassword(): void {
    if (this.changingPw) return;
    this.pwErr = '';
    this.pwNote = '';

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
        this.pwNote = 'Password changed.';
        this.pwForm = { current_password: '', new_password: '', confirm_password: '' };
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
