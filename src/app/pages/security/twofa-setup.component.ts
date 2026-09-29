import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TwofaService } from '../../core/services/twofa.service';

@Component({
  selector: 'app-twofa-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './twofa-setup.component.html',
  styles: [`
    .tf-wrap { max-width: 32rem; margin: 0 auto; }
    .tf-full { width: 100%; }
    .tf-gap { margin-top: .9rem; }
    .tf-hint { margin: -.4rem 0 1rem; }
    .tf-state { display: flex; align-items: center; gap: .8rem; padding: .9rem; border-radius: 12px; margin-bottom: 1rem; }
    .tf-state.is-on { background: #e7f8ee; color: #157347; }
    .tf-state.is-off { background: #fff5e0; color: #8a4b00; }
    :host-context(.dark) .tf-state.is-on { background: #10331f; color: #6fdba0; }
    :host-context(.dark) .tf-state.is-off { background: #362a10; color: #f7c667; }
    .tf-icon { width: 2.5rem; height: 2.5rem; border-radius: 999px; display: grid; place-items: center; background: rgba(255,255,255,.7); flex: none; }
    :host-context(.dark) .tf-icon { background: rgba(0,0,0,.25); }
    .tf-icon svg { width: 1.25rem; height: 1.25rem; }
    .tf-state-title { margin: 0; font-weight: 700; }
    .tf-state-sub { margin: .1rem 0 0; font-size: .8rem; }
    .tf-qr { display: flex; justify-content: center; margin-bottom: 1rem; }
    .tf-qr img { border: 1px solid var(--mexa-rule); border-radius: 12px; background: #fff; }
    .tf-key { background: var(--mexa-row-alt); border-radius: 10px; padding: .7rem .9rem; margin-bottom: 1rem; }
    .tf-key-label { margin: 0; font-size: .78rem; color: var(--mexa-ink-3); }
    .tf-key-value { margin: .2rem 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: var(--mexa-ink); overflow-wrap: anywhere; }
    .tf-code { text-align: center; font-size: 1.15rem; letter-spacing: .35em; }
    .tf-codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: .45rem; margin: 1rem 0; }
    .tf-codes code { border: 1px solid var(--mexa-rule); border-radius: 8px; padding: .45rem; text-align: center; font-size: .8rem; color: var(--mexa-ink); }
  `]
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
