import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ProgramService, PtMachine, PtFile, PtKind, PtJob, PtStatus } from '../../core/services/program.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

const key = () => crypto.randomUUID();
const open = (job: PtJob) => job.status === 'QUEUED' || job.status === 'DELIVERED';

@Component({
  selector: 'app-programs', standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './programs.component.html', styleUrl: './programs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgramsComponent implements OnInit, OnDestroy {
  machines: PtMachine[] = [];
  selectedMachineId: number | null = null;
  currentFile: PtFile | null = null;
  latestBackup: PtFile | null = null;
  jobs: PtJob[] = [];
  loadingStatus = false;
  statusError = '';
  connection = { ip_address: '', program_path: '' };
  connectionDirty = false;
  savingConnection = false;
  connectionError = '';
  requestingBackup = false;
  backupError = '';
  now = Date.now();

  files: PtFile[] = [];
  filesTotal = 0;
  filesPage = 1;
  readonly filesLimit = 25;
  loadingFiles = false;
  historyOpen = false;
  historyDirty = true;

  showUpload = false;
  uploadFile: File | null = null;
  uploadMachineId: number | null = null;
  uploading = false;
  uploadError = '';
  uploadErrorCode = '';
  overwrite = false;
  private uploadKey = '';
  private backupKey = key();
  private statusLoaded = false;
  private statusUpdatedAt = 0;
  private clock?: ReturnType<typeof setInterval>;
  private readonly destroy$ = new Subject<void>();
  private statusRequest?: Subscription;
  private filesRequest?: Subscription;
  private machineRequest?: Subscription;
  private poll?: ReturnType<typeof setTimeout>;
  private version = 0;
  private visibilityChanged = () => {
    if (document.hidden) { this.clearPoll(); this.statusRequest?.unsubscribe(); this.loadingStatus = false; }
    else {
      this.now = Date.now(); this.touch();
      if (!this.statusLoaded || this.jobs.some(open) || this.now - this.statusUpdatedAt >= 10_000) this.loadStatus();
    }
  };

  deviceDialog: {
    machine: PtMachine; label: string; token: string | null;
    confirmReplace: boolean; confirmRevoke: boolean; working: boolean; copied: boolean; error: string;
  } | null = null;

  constructor(private programs: ProgramService, private toast: ToastService,
    private cdr: ChangeDetectorRef, private auth: AuthService) {}

  get canUpload() { return this.auth.hasAction('programs', 'upload'); }
  get canTransfer() { return this.auth.hasAction('programs', 'transfer'); }
  get canPublish() { return this.canUpload && this.canTransfer; }
  get canBackup() { return this.auth.hasAction('programs', 'fetch'); }
  get canDelete() { return this.auth.hasAction('programs', 'delete'); }
  get canManageDevice() { return this.auth.hasAction('machines', 'edit'); }
  get selectedMachine() { return this.machines.find(m => m.id === this.selectedMachineId) || null; }
  get uploadMachine() { return this.machines.find(m => m.id === this.uploadMachineId) || null; }
  get filesPages() { return Math.max(1, Math.ceil(this.filesTotal / this.filesLimit)); }
  get busy() { return this.jobs.some(open) || this.uploading || this.requestingBackup; }
  get connectionReady() {
    const m = this.selectedMachine;
    return this.statusLoaded && !!m?.ip_address && !!m?.program_path && !!m?.device_id && !this.connectionDirty;
  }
  get operationsAllowed() { return this.connectionReady && !this.loadingStatus && !this.statusError && !this.savingConnection && !this.busy; }
  get sendJob() { return this.jobs.find(j => j.action === 'SEND') || null; }
  get backupJob() { return this.jobs.find(j => j.action === 'BACKUP') || null; }
  get canReplaceUpload() {
    return this.uploadErrorCode === 'FILE_EXISTS' ||
      (this.sendJob?.status === 'FAILED' && this.sendJob.error_code === 'FILE_EXISTS' &&
       this.sendJob.program_name === this.uploadFile?.name);
  }
  private touch() { this.cdr.markForCheck(); }

  ngOnInit() {
    this.loadMachines(true); document.addEventListener('visibilitychange', this.visibilityChanged);
    this.clock = setInterval(() => { if (!document.hidden) { this.now = Date.now(); this.touch(); } }, 30_000);
  }
  ngOnDestroy() {
    this.clearPoll(); document.removeEventListener('visibilitychange', this.visibilityChanged);
    if (this.clock) clearInterval(this.clock);
    this.destroy$.next(); this.destroy$.complete();
  }
  private clearPoll() { if (this.poll) clearTimeout(this.poll); this.poll = undefined; }
  private schedulePoll() {
    this.clearPoll();
    if (!document.hidden && this.jobs.some(open)) this.poll = setTimeout(() => this.loadStatus(), this.statusError ? 10_000 : 5_000);
  }
  loadMachines(first: boolean) {
    this.machineRequest?.unsubscribe();
    this.machineRequest = this.programs.getMachines().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.machines = res.data || [];
        if (!this.selectedMachineId || !this.selectedMachine) {
          this.selectedMachineId = this.machines[0]?.id ?? null; this.onMachineChange();
        }
        this.touch();
      },
      error: err => { if (first) this.toast.error(err.error?.message || 'Could not load machines'); this.touch(); }
    });
  }
  onMachineChange() {
    this.version++; this.clearPoll(); this.statusRequest?.unsubscribe(); this.filesRequest?.unsubscribe();
    this.currentFile = null; this.latestBackup = null; this.jobs = []; this.statusLoaded = false;
    this.statusError = ''; this.backupError = ''; this.connectionError = '';
    this.backupKey = key(); this.showUpload = false; this.uploadFile = null;
    this.connectionDirty = false;
    this.connection = { ip_address: this.selectedMachine?.ip_address || '', program_path: this.selectedMachine?.program_path || '' };
    this.files = []; this.filesTotal = 0; this.filesPage = 1; this.historyDirty = true; this.loadingFiles = false;
    this.loadStatus(); if (this.historyOpen) this.loadFiles();
  }
  private applyStatus(status: PtStatus) {
    const previousCurrent = this.currentFile?.id, previousBackup = this.latestBackup?.id;
    const m = this.selectedMachine;
    if (m) Object.assign(m, { device_id: null, online: false, last_seen_at: null }, status.machine);
    if (!this.connectionDirty && !this.savingConnection) {
      this.connection = { ip_address: status.machine.ip_address || '', program_path: status.machine.program_path || '' };
    }
    this.currentFile = status.file; this.latestBackup = status.backup; this.jobs = status.jobs || [];
    this.statusLoaded = true; this.statusError = '';
    if (previousCurrent !== this.currentFile?.id || previousBackup !== this.latestBackup?.id) {
      this.historyDirty = true; if (this.historyOpen) this.loadFiles();
    }
  }
  loadStatus() {
    const id = this.selectedMachineId;
    if (!id || document.hidden) return;
    this.clearPoll(); this.statusRequest?.unsubscribe();
    const version = this.version;
    this.loadingStatus = true;
    this.statusRequest = this.programs.getStatus(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.version) return;
        this.loadingStatus = false; this.now = Date.now(); this.statusUpdatedAt = this.now; this.applyStatus(res.data); this.schedulePoll(); this.touch();
      },
      error: err => {
        if (version !== this.version) return;
        this.loadingStatus = false; this.statusError = err.error?.message || 'Could not check this machine. Try again.';
        this.schedulePoll(); this.touch();
      }
    });
  }
  saveConnection() {
    const id = this.selectedMachineId;
    if (!id || !this.canManageDevice || this.savingConnection || this.busy) return;
    const connection = { ip_address: this.connection.ip_address.trim(), program_path: this.connection.program_path.trim() };
    if (!connection.ip_address || !connection.program_path) { this.connectionError = 'Enter the machine IP address and program folder.'; return; }
    this.savingConnection = true; this.connectionError = '';
    this.programs.saveConnection(id, connection).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.savingConnection = false;
        if (this.selectedMachineId === id && this.selectedMachine) {
          Object.assign(this.selectedMachine, res.data.machine); this.connectionDirty = false; this.connection = connection;
        }
        this.toast.success('Machine connection saved'); this.touch();
      },
      error: err => { this.savingConnection = false; this.connectionError = err.error?.message || 'Could not save the machine connection.'; this.touch(); }
    });
  }
  requestBackup() {
    const id = this.selectedMachineId;
    if (!id || !this.canBackup || !this.operationsAllowed) return;
    this.requestingBackup = true; this.backupError = '';
    this.programs.backup(id, this.backupKey).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.requestingBackup = false; this.backupKey = key();
        if (this.selectedMachineId === id) { this.jobs = this.jobs.filter(j => j.action !== 'BACKUP').concat(res.data.job); this.schedulePoll(); }
        this.touch();
      },
      error: err => {
        this.requestingBackup = false; this.backupError = err.error?.message || 'Could not request a backup. Retry uses the same request reference.';
        if (err.error?.code === 'COMMAND_PENDING') this.loadStatus();
        this.touch();
      }
    });
  }
  jobText(job: PtJob) {
    if (job.status === 'QUEUED') return 'Waiting for device';
    if (job.status === 'DELIVERED') return job.action === 'BACKUP' ? 'Reading the running program from the machine' : 'Device is transferring the file';
    if (job.status === 'DONE') return job.action === 'BACKUP' ? 'Fresh backup saved on server' : 'Machine transfer verified';
    return job.status === 'FAILED' ? 'Device operation failed' : 'Operation cancelled';
  }
  onHistoryToggle(event: Event) {
    this.historyOpen = (event.target as HTMLDetailsElement).open;
    if (this.historyOpen && this.historyDirty) this.loadFiles();
    if (!this.historyOpen) { this.filesRequest?.unsubscribe(); this.loadingFiles = false; }
  }
  loadFiles() {
    const id = this.selectedMachineId;
    if (!id || !this.historyOpen) return;
    const version = this.version;
    this.filesRequest?.unsubscribe(); this.loadingFiles = true; this.historyDirty = true;
    this.filesRequest = this.programs.getFiles({ machine_id: id, page: this.filesPage, limit: this.filesLimit }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.version) return;
        this.files = res.data || []; this.filesTotal = res.total || 0; this.loadingFiles = false; this.historyDirty = false; this.touch();
      },
      error: err => { if (version !== this.version) return; this.loadingFiles = false; this.toast.error(err.error?.message || 'Could not load saved files'); this.touch(); }
    });
  }
  changeFilesPage(step: number) { this.filesPage = Math.min(this.filesPages, Math.max(1, this.filesPage + step)); this.loadFiles(); }
  isCurrent(f: PtFile) { return f.id === this.currentFile?.id || !!f.is_current; }
  kindLabel(k: PtKind) { return k === 'NEW' ? 'Uploaded' : 'Backup'; }
  fileSize(bytes: number | null | undefined) {
    if (bytes == null) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  deviceState(m: PtMachine | null): 'online' | 'offline' | 'none' {
    return !m?.device_id ? 'none' : m.last_seen_at && this.now - new Date(m.last_seen_at).getTime() < 60_000 ? 'online' : 'offline';
  }
  ago(iso: string | null) {
    if (!iso) return 'never';
    const seconds = Math.max(0, Math.round((this.now - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} d ago`;
  }
  download(f: PtFile) {
    this.programs.download(f.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = f.program_name; a.click(); URL.revokeObjectURL(url);
      },
      error: () => { this.toast.error('Could not download the file'); this.touch(); }
    });
  }
  deleteFile(f: PtFile) {
    if (!this.canDelete || this.isCurrent(f) || !confirm(`Delete saved file ${f.program_name}?`)) return;
    this.programs.delete(f.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success('File deleted'); this.historyDirty = true; this.loadFiles(); this.loadStatus(); },
      error: err => { this.toast.error(err.error?.message || 'Could not delete the file'); this.touch(); }
    });
  }


  openUpload() {
    if (!this.canPublish || !this.operationsAllowed || !this.selectedMachine) return;
    this.uploadMachineId = this.selectedMachineId; this.uploadFile = null; this.uploadError = ''; this.uploadErrorCode = '';
    this.overwrite = false; this.uploadKey = key(); this.showUpload = true;
  }
  closeUpload() { if (!this.uploading) this.showUpload = false; }
  onFileSelected(event: Event) {
    if (this.uploading) return;
    this.uploadFile = (event.target as HTMLInputElement).files?.[0] || null;
    this.uploadError = ''; this.uploadErrorCode = ''; this.overwrite = false; this.uploadKey = key();
  }
  overwriteChanged() { this.uploadKey = key(); }
  upload() {
    const machine = this.uploadMachine, file = this.uploadFile;
    if (!this.canPublish || !machine || !file || this.uploading || !this.operationsAllowed || this.uploadMachineId !== this.selectedMachineId) return;
    this.uploading = true; this.uploadError = '';
    this.programs.transfer(machine.id, file, this.uploadKey, this.canReplaceUpload && this.overwrite).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.uploading = false; this.showUpload = false;
        if (this.selectedMachineId === machine.id) {
          this.currentFile = res.data.file; this.jobs = this.jobs.filter(j => j.action !== 'SEND').concat(res.data.job);
          this.historyDirty = true; this.filesPage = 1; if (this.historyOpen) this.loadFiles(); this.schedulePoll();
        }
        this.toast.success('File saved on server. Waiting for machine confirmation.'); this.touch();
      },
      error: err => {
        this.uploading = false; this.uploadError = err.error?.message || 'Could not upload and transfer. Retry uses the same request reference.';
        this.uploadErrorCode = err.error?.code || '';
        if (this.uploadErrorCode === 'COMMAND_PENDING') this.loadStatus();
        this.touch();
      }
    });
  }
  openDevice() {
    const machine = this.selectedMachine;
    if (!machine || !this.canManageDevice || this.busy) return;
    this.deviceDialog = { machine, label: machine.device_label || '', token: null,
      confirmReplace: false, confirmRevoke: false, working: false, copied: false, error: '' };
  }
  closeDevice() { if (!this.deviceDialog?.working) { this.deviceDialog = null; } }
  createToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (d.machine.device_id && !d.confirmReplace) { d.confirmReplace = true; return; }
    d.working = true; d.error = '';
    this.programs.createDeviceToken(d.machine.id, d.label.trim() || undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { d.working = false; d.confirmReplace = false; d.token = res.data.token; this.loadMachines(false); this.loadStatus(); this.touch(); },
      error: err => { d.working = false; d.error = err.error?.message || 'Could not create token'; this.touch(); }
    });
  }
  revokeToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (!d.confirmRevoke) { d.confirmRevoke = true; return; }
    d.working = true;
    this.programs.revokeDeviceToken(d.machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { d.working = false; this.toast.success('Device token revoked'); this.closeDevice(); this.loadMachines(false); this.loadStatus(); this.touch(); },
      error: err => { d.working = false; d.error = err.error?.message || 'Could not revoke token'; this.touch(); }
    });
  }
  deviceConfig(token: string) { return `MEXA_URL=${this.programs.serverUrl}\nMEXA_DEVICE_TOKEN=${token}`; }
  copyConfig() {
    const d = this.deviceDialog;
    if (!d?.token) return;
    navigator.clipboard?.writeText(this.deviceConfig(d.token)).then(
      () => { d.copied = true; this.touch(); },
      () => this.toast.error('Select the configuration text and copy it')
    );
  }
}
