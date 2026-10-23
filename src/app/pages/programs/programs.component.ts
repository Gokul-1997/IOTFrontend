import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Injector, OnDestroy, OnInit, afterNextRender, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { ProgramService, PtFile, PtFilter, PtGateway, PtMachine, PtPage } from '../../core/services/program.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { takeLinkedRecord } from '../../shared/linked-record';
import { controllerTypeLabel } from '../machines/controller-types';

/** The server's limit (PROGRAM_MAX_MB); said before sending, so a big file is not uploaded for nothing. */
const MAX_BYTES = 20 * 1024 * 1024;
/** While the page is shown: gateway online/offline, programs moving along the line, a backup arriving. */
const REFRESH_MS = 15_000;

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st */
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/*
 * Program Transfer, kept simple (21 Oct 2026, the user: "machine select,
 * upload and download only — no company, no plant, no FTP or FANUC"):
 *
 *   choose a machine → upload programs (they wait in line; the gateway
 *   sends them one at a time, oldest first), download any file, delete
 *   one, ask the machine for a backup.
 *
 * The company has one gateway for all its machines, and S&T makes its token
 * (22 Oct 2026: "super admin side … don't company side"); this page only
 * says whether it is online. Forms open in the app's one dialog; "Are you
 * sure?" is ConfirmService.
 */
@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent, SkeletonRowsComponent, MexaPagerComponent],
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

  /** The company's gateway (null: S&T has not made its token yet). */
  gateway: PtGateway | null = null;
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
    /* A company's access is set from the platform's own login, the S&T Super
       Admin — not from the company's admin, whatever the company is called
       (one is "S AND T"): name both, so it is clear which login to use. */
    const company = this.auth.getUser()?.company_name || 'this company';
    return companyLacks || this.auth.isCompanyAdmin()
      ? `Uploading is not switched on for ${company}. Sign in as the S&T Super Admin → Companies → Manage Access → ${company} → Program Transfer, and tick "Upload to library" and "Send to machine".`
      : 'Your role cannot upload programs. Your company admin can tick Program Transfer → "Upload to library" and "Send to machine" for your role under Roles & Permissions.';
  }
  get canBackup() { return this.auth.hasAction('programs', 'fetch'); }
  /** Who may open the Machines page, where a wrong program path, IP or controller is put right. */
  get canOpenMachines() { return this.auth.hasPermission('page:machines'); }
  /** "Fanuc", "Mitsubishi" — or '' when not set. */
  typeLabel(value: string | null | undefined): string { return controllerTypeLabel(value); }
  get canDelete() { return this.auth.hasAction('programs', 'delete'); }
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
        this.gateway = res.gateway ?? null;
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

  /** What the gateway did since the last look — a backup, a program taken or refused, the line moving: say so and show it. */
  private noticeChanges(before: PtMachine, now: PtMachine): void {
    const backupArrived = now.last_backup && now.last_backup.id !== before.last_backup?.id;
    if (backupArrived && before.backup_request) this.toast.success(`Backup received from ${now.machine_serial_no}`);
    if (!backupArrived && before.backup_request && now.backup_failure && !now.backup_request) {
      this.toast.error(`${now.machine_serial_no} could not send a backup: ${now.backup_failure.message}`);
    }
    const report = now.last_report;
    const reported = !!report && (report.id !== before.last_report?.id || report.delivery_status !== before.last_report?.delivery_status);
    if (reported && report!.delivery_status === 'DONE') this.toast.success(`${report!.program_name} is on ${now.machine_serial_no}`);
    if (reported && report!.delivery_status === 'FAILED') {
      this.toast.error(`${now.machine_serial_no} could not use ${report!.program_name}: ${report!.delivery_message}`);
    }
    if (backupArrived || reported || now.next?.id !== before.next?.id || now.waiting !== before.waiting) this.loadFiles();
  }

  changeMachine(): void {
    this.page = 1;
    this.files = [];
    this.loadFiles();
  }

  /** The company's one gateway, for every machine. */
  gatewayState(g = this.gateway): 'online' | 'offline' | 'none' {
    return !g ? 'none' : g.online ? 'online' : 'offline';
  }

  gatewayLabel(g = this.gateway): string {
    if (!g) return 'No gateway yet — S&T sets it up';
    if (g.online) return 'Gateway online';
    return g.last_seen_at ? `Gateway offline · last seen ${this.ago(g.last_seen_at)}` : 'Gateway has not connected yet';
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

  /** An upload's state: its place in the machine's line, or what the gateway reported. */
  deliveryLabel(f: Pick<PtFile, 'delivery_status' | 'queue_position' | 'sent_to_gateway_at'>): string {
    if (f.delivery_status === 'DONE') return 'On the machine';
    if (f.delivery_status === 'FAILED') return 'Refused by machine';
    if (f.delivery_status === 'SKIPPED') return 'Not sent';
    // downloaded by the gateway, which has not reported yet
    if (f.queue_position === 1 && f.sent_to_gateway_at) return 'With the gateway';
    if (f.queue_position === 1) return 'Next to send';
    return f.queue_position ? `Waiting · ${ordinal(f.queue_position)} in line` : 'Waiting';
  }

  deliveryClass(f: Pick<PtFile, 'delivery_status' | 'queue_position'>): string {
    return f.delivery_status === 'DONE' ? 'mexa-badge-good' : f.delivery_status === 'FAILED' ? 'mexa-badge-bad'
      : !f.delivery_status && f.queue_position === 1 ? 'mexa-badge-info' : 'mexa-badge-neutral';
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
    const machine = this.selectedMachine?.machine_serial_no || 'the machine';
    const waiting = file.kind === 'NEW' && !file.delivery_status;
    const yes = await this.confirm.ask({
      title: `Delete ${file.program_name}?`,
      message: waiting
        ? `It is taken out of ${machine}'s line and never sent to the machine.`
        : `This ${file.kind === 'NEW' ? 'upload' : 'backup'} of ${machine} is removed from the server.`,
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
          const name = event.body?.data?.program_name || file.name;
          const place = event.body?.data?.queue_position;
          this.toast.success(place === 1 ? `${name} is next to send to ${machine.machine_serial_no}`
            : place ? `${name} is ${ordinal(place)} in line for ${machine.machine_serial_no}` : `${name} uploaded for ${machine.machine_serial_no}`);
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
