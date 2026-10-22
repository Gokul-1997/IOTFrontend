import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Injector, OnDestroy, OnInit, afterNextRender, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { ProgramService, PtFile, PtFilter, PtMachine, PtPage } from '../../core/services/program.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { environment } from '../../../environments/environment';
import { takeLinkedRecord } from '../../shared/linked-record';

/** The server's limit (PROGRAM_MAX_MB); said before sending, so a big file is not uploaded for nothing. */
const MAX_BYTES = 20 * 1024 * 1024;
/** While the page is shown: gateway online/offline, a backup arriving. */
const REFRESH_MS = 15_000;

/*
 * Program Transfer, kept simple (21 Oct 2026, the user: "machine select,
 * upload and download only — no company, no plant, no FTP or FANUC"):
 *
 *   choose a machine → upload its program (the gateway downloads it),
 *   download any file, delete an old one, ask the machine for a backup.
 *
 * The machine's gateway does the rest with its own token and three calls;
 * an admin makes that token here (Gateway token). Forms open in the app's
 * one dialog; "Are you sure?" is ConfirmService.
 */
@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent, SkeletonRowsComponent, MexaPagerComponent],
  templateUrl: './programs.component.html',
  styleUrl: './programs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgramsComponent implements OnInit, OnDestroy {
  private readonly programs = inject(ProgramService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  /** What a notification opened (?machine_id=&file_id=): that machine, its file marked. */
  private linkedMachineId: number | null = null;
  linkedFileId: number | null = null;

  readonly maxMb = MAX_BYTES / 1048576;
  readonly apiBase = `${environment.apiUrl}/device/v1`;

  machines: PtMachine[] = [];
  selectedMachineId: number | null = null;
  loadingMachines = true;
  machinesError = '';

  files: PtFile[] = [];
  filter: PtFilter = '';
  page = 1;
  limit = 20;
  pagination: PtPage = { page: 1, limit: 20, total: 0, totalPages: 1 };
  loadingFiles = false;
  filesError = '';

  showUpload = false;
  uploadFile: File | null = null;
  uploading = false;
  uploadProgress: number | null = null;
  uploadError = '';

  requestingBackup = false;

  tokenDialog: { machine: PtMachine; token: string | null; working: boolean; copied: boolean; error: string } | null = null;

  private readonly destroy$ = new Subject<void>();
  private machinesRequest?: Subscription;
  private filesRequest?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private readonly onVisibility = () => { if (!document.hidden) this.loadMachines(true); };

  get canUpload() { return this.auth.hasAction('programs', 'upload') && this.auth.hasAction('programs', 'transfer'); }

  /**
   * Why there is no Upload button, said where it would be — it simply was not
   * there, and nobody could tell why (22 Oct 2026). Uploading needs Program
   * Transfer's "Upload to library" and "Send to machine": the role must hold
   * both and the company must have been given both (as the API checks).
   */
  get uploadBlockedReason(): string {
    if (this.canUpload) return '';
    const keys = ['page:programs:upload', 'page:programs:transfer'];
    const granted = this.auth.getCompanyPermissions();
    const companyLacks = granted.length > 0 && keys.some(k => !granted.includes(k));
    return companyLacks || this.auth.isCompanyAdmin()
      ? 'Uploading is not switched on for your company. S&T can allow Program Transfer → "Upload to library" and "Send to machine" under Companies → Manage Access.'
      : 'Your role cannot upload programs. Your company admin can give it Program Transfer → "Upload to library" and "Send to machine" under Roles & Permissions.';
  }
  get canBackup() { return this.auth.hasAction('programs', 'fetch'); }
  get canDelete() { return this.auth.hasAction('programs', 'delete'); }
  get canManageToken() { return this.auth.hasAction('machines', 'edit'); }
  get selectedMachine(): PtMachine | null { return this.machines.find(m => m.id === this.selectedMachineId) || null; }

  ngOnInit(): void {
    const linked = takeLinkedRecord(this.route, this.router, ['machine_id', 'file_id']);
    this.linkedMachineId = linked.machine_id ?? null;
    this.linkedFileId = linked.file_id ?? null;
    this.loadMachines();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.timer = setInterval(() => { if (!document.hidden) this.loadMachines(true); }, REFRESH_MS);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearInterval(this.timer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* ── machines ── */

  /** quiet: a background refresh — no spinner, no error banner, and it notices a backup arriving. */
  loadMachines(quiet = false): void {
    if (quiet && (this.machinesRequest && !this.machinesRequest.closed)) return;
    const before = this.selectedMachine;
    if (!quiet) { this.loadingMachines = true; this.machinesError = ''; }
    this.machinesRequest = this.programs.getMachines().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.machines = res.data || [];
        this.loadingMachines = false;
        if (!this.selectedMachine) {
          // the machine a notification is about, else the first
          const linked = this.machines.find(m => m.id === this.linkedMachineId);
          this.selectedMachineId = linked?.id ?? this.machines[0]?.id ?? null;
          this.changeMachine();
        } else if (quiet && before) {
          this.noticeChanges(before, this.selectedMachine!);
        }
        this.cdr.markForCheck();
      },
      error: err => {
        this.loadingMachines = false;
        if (!quiet) this.machinesError = err?.error?.message || 'Could not load the machines.';
        this.cdr.markForCheck();
      }
    });
  }

  /** What the gateway did since the last look — a backup, the program taken or refused: say so and show it. */
  private noticeChanges(before: PtMachine, now: PtMachine): void {
    const backupArrived = now.last_backup && now.last_backup.id !== before.last_backup?.id;
    if (backupArrived && before.backup_request) this.toast.success(`Backup received from ${now.machine_serial_no}`);
    if (!backupArrived && before.backup_request && now.backup_failure && !now.backup_request) {
      this.toast.error(`${now.machine_serial_no} could not send a backup: ${now.backup_failure.message}`);
    }
    const reported = now.program && now.program.id === before.program?.id
      && now.program.delivery_status && now.program.delivery_status !== before.program?.delivery_status;
    if (reported && now.program!.delivery_status === 'DONE') this.toast.success(`${now.program!.program_name} is on ${now.machine_serial_no}`);
    if (reported && now.program!.delivery_status === 'FAILED') {
      this.toast.error(`${now.machine_serial_no} could not use ${now.program!.program_name}: ${now.program!.delivery_message}`);
    }
    if (backupArrived || reported || now.program?.id !== before.program?.id) this.loadFiles();
  }

  changeMachine(): void {
    this.page = 1;
    this.files = [];
    this.loadFiles();
  }

  gatewayState(m: PtMachine): 'online' | 'offline' | 'none' {
    return !m.gateway ? 'none' : m.gateway.online ? 'online' : 'offline';
  }

  gatewayLabel(m: PtMachine): string {
    if (!m.gateway) return 'No gateway token yet';
    if (m.gateway.online) return 'Gateway online';
    return m.gateway.last_seen_at ? `Gateway offline · last seen ${this.ago(m.gateway.last_seen_at)}` : 'Gateway has not connected yet';
  }

  /* ── files ── */

  loadFiles(): void {
    const machine = this.selectedMachine;
    this.filesRequest?.unsubscribe();
    if (!machine) { this.files = []; this.loadingFiles = false; return; }
    this.loadingFiles = true;
    this.filesError = '';
    this.filesRequest = this.programs.getFiles(machine.id, this.filter, this.page, this.limit)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: res => {
          this.files = res.data || [];
          this.pagination = res.pagination || { page: this.page, limit: this.limit, total: this.files.length, totalPages: 1 };
          this.loadingFiles = false;
          this.cdr.markForCheck();
          this.showLinkedFile();
        },
        error: err => {
          this.files = [];
          this.loadingFiles = false;
          this.filesError = err?.error?.message || 'Could not load the files.';
          this.cdr.markForCheck();
        }
      });
  }

  /** The file a notification opened, on screen: scrolled to and focused (it is marked in the table). */
  private showLinkedFile(): void {
    const id = this.linkedFileId;
    if (!id || !this.files.some(f => f.id === id)) return;
    afterNextRender(() => {
      const row = document.getElementById(`pt-file-${id}`);
      row?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      row?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  setFilter(filter: PtFilter): void { this.filter = filter; this.page = 1; this.loadFiles(); }
  goToPage(page: number): void { this.page = page; this.loadFiles(); }
  setLimit(limit: number): void { this.limit = limit; this.page = 1; this.loadFiles(); }

  kindLabel(f: Pick<PtFile, 'kind'>): string { return f.kind === 'NEW' ? 'Uploaded' : 'Backup'; }

  /** An upload's state at the machine, as its gateway reported it. */
  deliveryLabel(f: Pick<PtFile, 'delivery_status'>): string {
    return f.delivery_status === 'DONE' ? 'On the machine' : f.delivery_status === 'FAILED' ? 'Refused by machine' : 'Waiting';
  }

  deliveryClass(f: Pick<PtFile, 'delivery_status'>): string {
    return f.delivery_status === 'DONE' ? 'mexa-badge-good' : f.delivery_status === 'FAILED' ? 'mexa-badge-bad' : 'mexa-badge-neutral';
  }

  download(file: { id: number; program_name: string }): void {
    this.programs.download(file.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.program_name;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error(`Could not download ${file.program_name}`)
    });
  }

  async deleteFile(file: PtFile): Promise<void> {
    const yes = await this.confirm.ask({
      title: `Delete ${file.program_name}?`,
      message: `This ${file.kind === 'NEW' ? 'upload' : 'backup'} of ${this.selectedMachine?.machine_serial_no || 'the machine'} is removed from the server.`,
      confirmText: 'Delete',
      icon: 'delete_forever'
    });
    if (!yes) return;
    this.programs.remove(file.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success(`${file.program_name} deleted`); this.loadFiles(); this.loadMachines(true); },
      error: err => this.toast.error(err?.error?.message || `Could not delete ${file.program_name}`)
    });
  }

  /* ── upload ── */

  openUpload(): void {
    this.uploadFile = null;
    this.uploadError = '';
    this.uploadProgress = null;
    this.showUpload = true;
  }

  closeUpload(): void {
    if (this.uploading) return;
    this.showUpload = false;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile = input.files?.[0] || null;
    this.uploadError = !this.uploadFile ? ''
      : !this.uploadFile.size ? 'This file is empty.'
      : this.uploadFile.size > MAX_BYTES ? `This file is larger than ${this.maxMb} MB.` : '';
  }

  upload(): void {
    const machine = this.selectedMachine;
    if (!machine || this.uploading) return;
    if (!this.uploadFile) { this.uploadError = 'Choose the program file.'; return; }
    if (this.uploadError) return;
    const file = this.uploadFile;
    this.uploading = true;
    this.uploadProgress = 0;
    this.programs.upload(machine.id, file).pipe(takeUntil(this.destroy$)).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
        } else if (event.type === HttpEventType.Response) {
          this.uploading = false;
          this.showUpload = false;
          this.toast.success(`${event.body?.data?.program_name || file.name} is now ${machine.machine_serial_no}'s program`);
          this.page = 1;
          this.loadFiles();
          this.loadMachines(true);
        }
        this.cdr.markForCheck();
      },
      error: err => {
        this.uploading = false;
        this.uploadProgress = null;
        this.uploadError = err?.error?.message || 'Could not upload the file. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  /* ── backup ── */

  requestBackup(): void {
    const machine = this.selectedMachine;
    if (!machine || this.requestingBackup) return;
    this.requestingBackup = true;
    this.programs.requestBackup(machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.requestingBackup = false;
        machine.backup_request = { id: res.data.id, requested_at: res.data.requested_at };
        this.toast.success(res.data.created
          ? `Backup asked for. ${machine.machine_serial_no}'s gateway sends it on its next check.`
          : 'A backup is already asked for — waiting for the gateway.');
        this.cdr.markForCheck();
      },
      error: err => {
        this.requestingBackup = false;
        this.toast.error(err?.error?.message || 'Could not ask for a backup');
        this.cdr.markForCheck();
      }
    });
  }

  /* ── gateway token ── */

  openToken(machine: PtMachine): void {
    this.tokenDialog = { machine, token: null, working: false, copied: false, error: '' };
  }

  closeToken(): void {
    if (this.tokenDialog?.working) return;
    this.tokenDialog = null;
  }

  async createToken(): Promise<void> {
    const t = this.tokenDialog;
    if (!t || t.working) return;
    if (t.machine.gateway) {
      const yes = await this.confirm.ask({
        title: `Replace the gateway token of ${t.machine.machine_serial_no}?`,
        message: 'The current token stops working at once. Put the new one in the gateway straight away.',
        confirmText: 'Replace token'
      });
      if (!yes || this.tokenDialog !== t) return;
    }
    t.working = true;
    t.error = '';
    this.programs.createToken(t.machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        t.working = false;
        t.token = res.data.token;
        this.loadMachines(true);
        this.cdr.markForCheck();
      },
      error: err => {
        t.working = false;
        t.error = err?.error?.message || 'Could not make the token. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  async revokeToken(): Promise<void> {
    const t = this.tokenDialog;
    if (!t || t.working) return;
    const yes = await this.confirm.ask({
      title: `Revoke the gateway token of ${t.machine.machine_serial_no}?`,
      message: 'Its gateway stops at once: no downloads, no backups, until it gets a new token.',
      confirmText: 'Revoke token'
    });
    if (!yes || this.tokenDialog !== t) return;
    t.working = true;
    this.programs.revokeToken(t.machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.tokenDialog = null;
        this.toast.success(`Gateway token of ${t.machine.machine_serial_no} revoked`);
        this.loadMachines(true);
        this.cdr.markForCheck();
      },
      error: err => {
        t.working = false;
        t.error = err?.error?.message || 'Could not revoke the token. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  copyToken(): void {
    const t = this.tokenDialog;
    if (!t?.token) return;
    navigator.clipboard?.writeText(t.token).then(
      () => { t.copied = true; this.cdr.markForCheck(); },
      () => this.toast.error('Could not copy — select the token and copy it by hand')
    );
  }

  /* ── formatting ── */

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  ago(iso: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  trackFile = (_: number, f: PtFile) => f.id;
}
