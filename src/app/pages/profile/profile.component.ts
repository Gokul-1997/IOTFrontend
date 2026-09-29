import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile.component.html'
})
export class ProfileComponent implements OnInit {

  loading = true;
  errorMsg = '';
  profile: any = null;

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

  roleLabel(userType: string): string {
    if (!userType) return '--';
    return userType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
