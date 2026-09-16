import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TwofaService } from '../../core/services/twofa.service';

@Component({
  selector: 'app-twofa-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './twofa-setup.component.html'
})
export class TwofaSetupComponent implements OnInit {
  status: any = null;
  step: 'status' | 'setup' | 'verify' | 'backup' = 'status';
  qrDataUrl = '';
  secret = '';
  token = '';
  backupCodes: string[] = [];
  error = '';
  loading = false;

  /* Zoneless: the QR code, the backup codes and every error below are only
     painted because these callbacks mark the view for check. */
  constructor(private svc: TwofaService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadStatus(); }

  loadStatus() {
    this.svc.getStatus().subscribe({ next: r => { this.status = r.data; this.cdr.markForCheck(); } });
  }

  startSetup() {
    this.loading = true;
    this.svc.setup().subscribe({
      next: r => { this.qrDataUrl = r.data.qrDataUrl; this.secret = r.data.secret; this.step = 'setup'; this.loading = false; this.cdr.markForCheck(); },
      error: e => { this.error = e.error?.message || 'Setup failed'; this.loading = false; this.cdr.markForCheck(); }
    });
  }

  enable() {
    if (!this.token) { this.error = 'Enter the 6-digit code'; return; }
    this.loading = true;
    this.svc.enable(this.token).subscribe({
      next: r => { this.backupCodes = r.data.backup_codes; this.step = 'backup'; this.loading = false; this.cdr.markForCheck(); this.loadStatus(); },
      error: e => { this.error = e.error?.message || 'Invalid code'; this.loading = false; this.cdr.markForCheck(); }
    });
  }

  disable() {
    if (!confirm('Are you sure you want to disable 2FA?')) return;
    this.svc.disable().subscribe({ next: () => { this.step = 'status'; this.cdr.markForCheck(); this.loadStatus(); } });
  }
}
