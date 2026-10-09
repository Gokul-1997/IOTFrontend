import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ProgramService, PtMachine, PtFile, PtKind } from '../../core/services/program.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

/** A published file is available to the device, not proof of a CNC write or execution. */
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
  files: PtFile[] = [];
  filesTotal = 0;
  filesPage = 1;
  readonly filesLimit = 25;
  loadingFiles = false;
  loadingCurrent = false;
  loadingBackup = false;
  currentError = '';
  backupError = '';
  now = Date.now();

  showUpload = false;
  uploadFile: File | null = null;
  uploadMachineId: number | null = null;
  uploading = false;
  uploadError = '';

  deviceDialog: {
    machine: PtMachine; label: string; token: string | null;
    confirmReplace: boolean; confirmRevoke: boolean; working: boolean; copied: boolean; error: string;
  } | null = null;

  private readonly destroy$ = new Subject<void>();
  private timer?: ReturnType<typeof setInterval>;
  private versions = { machines: 0, current: 0, backup: 0, files: 0 };
  private pending = { machines: false, current: false, backup: false };
  private visibilityChanged = () => { if (!document.hidden) this.refresh(); };

  constructor(private programs: ProgramService, private toast: ToastService,
    private cdr: ChangeDetectorRef, private auth: AuthService) {}

  get canUpload() { return this.auth.hasAction('programs', 'upload'); }
  get canTransfer() { return this.auth.hasAction('programs', 'transfer'); }
  get canPublish() { return this.canUpload && this.canTransfer; }
  get canDelete() { return this.auth.hasAction('programs', 'delete'); }
  get canManageDevice() { return this.auth.hasAction('machines', 'edit'); }
  get selectedMachine() { return this.machines.find(m => m.id === this.selectedMachineId) || null; }
  get uploadMachine() { return this.machines.find(m => m.id === this.uploadMachineId) || null; }
  get filesPages() { return Math.max(1, Math.ceil(this.filesTotal / this.filesLimit)); }
  private touch() { this.cdr.markForCheck(); }

  ngOnInit() {
    this.loadMachines(true);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 10_000);
  }
  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.destroy$.next(); this.destroy$.complete();
  }
  private refresh() {
    this.now = Date.now();
    this.loadMachines(false);
    if (!this.pending.current) this.loadCurrent(true);
    if (!this.pending.backup) this.loadBackup(true);
    this.touch();
  }

  loadMachines(first: boolean) {
    if (this.pending.machines) return;
    this.pending.machines = true;
    const version = ++this.versions.machines;
    this.programs.getMachines().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.machines) return;
        this.pending.machines = false;
        this.machines = res.data || [];
        if (!this.selectedMachineId || !this.selectedMachine) {
          this.selectedMachineId = this.machines[0]?.id ?? null;
          this.onMachineChange();
        }
        this.touch();
      },
      error: err => {
        this.pending.machines = false;
        if (first) this.toast.error(err.error?.message || 'Could not load machines');
        this.touch();
      }
    });
  }
  onMachineChange() {
    this.versions.current++; this.versions.backup++; this.versions.files++;
    this.pending.current = false; this.pending.backup = false;
    this.currentFile = null; this.latestBackup = null; this.files = []; this.filesTotal = 0; this.filesPage = 1;
    this.currentError = ''; this.backupError = '';
    this.loadingCurrent = false; this.loadingBackup = false; this.loadingFiles = false;
    if (this.selectedMachineId) { this.loadCurrent(); this.loadBackup(); this.loadFiles(); }
  }
  loadCurrent(refreshFiles = false) {
    const id = this.selectedMachineId;
    if (!id) return;
    const version = ++this.versions.current;
    this.loadingCurrent = true; this.pending.current = true;
    this.programs.getCurrentProgram(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.current) return;
        const changed = this.currentFile?.id !== res.data.file?.id;
        this.currentFile = res.data.file || null;
        this.currentError = ''; this.loadingCurrent = false; this.pending.current = false;
        if (changed && refreshFiles) this.loadFiles();
        this.touch();
      },
      error: err => {
        if (version !== this.versions.current) return;
        this.currentError = err.error?.message || 'Could not check the current program. Try again.';
        this.loadingCurrent = false; this.pending.current = false; this.touch();
      }
    });
  }
  loadBackup(refreshFiles = false) {
    const id = this.selectedMachineId;
    if (!id) return;
    const version = ++this.versions.backup;
    this.loadingBackup = true; this.pending.backup = true;
    this.programs.getFiles({ machine_id: id, kind: 'BACKUP', limit: 1 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.backup) return;
        const next = res.data?.[0] || null;
        const changed = this.latestBackup?.id !== next?.id;
        this.latestBackup = next; this.backupError = '';
        this.loadingBackup = false; this.pending.backup = false;
        if (changed && refreshFiles) this.loadFiles();
        this.touch();
      },
      error: err => {
        if (version !== this.versions.backup) return;
        this.backupError = err.error?.message || 'Could not check the latest backup.';
        this.loadingBackup = false; this.pending.backup = false; this.touch();
      }
    });
  }
  loadFiles() {
    const id = this.selectedMachineId;
    if (!id) return;
    const version = ++this.versions.files;
    this.loadingFiles = true;
    this.programs.getFiles({ machine_id: id, page: this.filesPage, limit: this.filesLimit }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.files) return;
        this.files = res.data || []; this.filesTotal = res.total || 0; this.loadingFiles = false; this.touch();
      },
      error: err => {
        if (version !== this.versions.files) return;
        this.loadingFiles = false; this.toast.error(err.error?.message || 'Could not load saved files'); this.touch();
      }
    });
  }
  changeFilesPage(step: number) {
    this.filesPage = Math.min(this.filesPages, Math.max(1, this.filesPage + step)); this.loadFiles();
  }
  isCurrent(f: PtFile) { return f.id === this.currentFile?.id || !!f.is_current; }
  kindLabel(k: PtKind) { return k === 'NEW' ? 'Uploaded' : 'Backup'; }
  fileSize(bytes: number | null | undefined) {
    if (bytes == null) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  deviceState(m: PtMachine | null): 'online' | 'offline' | 'none' {
    return !m?.device_id ? 'none' : m.online ? 'online' : 'offline';
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
      next: () => { this.toast.success('File deleted'); this.loadFiles(); this.loadBackup(); },
      error: err => { this.toast.error(err.error?.message || 'Could not delete the file'); this.touch(); }
    });
  }

  openUpload() {
    if (!this.canPublish || !this.selectedMachine || this.uploading) return;
    this.uploadMachineId = this.selectedMachineId; this.uploadFile = null; this.uploadError = ''; this.showUpload = true;
  }
  closeUpload() { if (!this.uploading) this.showUpload = false; }
  onFileSelected(event: Event) {
    if (this.uploading) return;
    this.uploadFile = (event.target as HTMLInputElement).files?.[0] || null; this.uploadError = '';
  }
  upload() {
    if (!this.canPublish || this.uploading || !this.uploadFile || !this.uploadMachine) return;
    const machine = this.uploadMachine;
    const file = this.uploadFile;
    this.uploading = true; this.uploadError = '';
    this.programs.publishProgram(machine.id, file).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.uploading = false; this.showUpload = false;
        this.toast.success(`${res.data.file.program_name} is ready for ${machine.machine_serial_no} to download.`);
        if (this.selectedMachineId === machine.id) {
          this.versions.current++; this.pending.current = false; this.loadingCurrent = false;
          this.currentFile = res.data.file; this.currentError = ''; this.filesPage = 1; this.loadFiles();
        }
        this.touch();
      },
      error: err => { this.uploading = false; this.uploadError = err.error?.message || 'Upload failed. Try again.'; this.touch(); }
    });
  }

  openDevice() {
    const machine = this.selectedMachine;
    if (!machine || !this.canManageDevice) return;
    this.deviceDialog = { machine, label: machine.device_label || '', token: null,
      confirmReplace: false, confirmRevoke: false, working: false, copied: false, error: '' };
  }
  closeDevice() { if (!this.deviceDialog?.working) { this.deviceDialog = null; this.loadMachines(false); } }
  createToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (d.machine.device_id && !d.confirmReplace) { d.confirmReplace = true; return; }
    d.working = true; d.error = '';
    this.programs.createDeviceToken(d.machine.id, d.label.trim() || undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { d.working = false; d.confirmReplace = false; d.token = res.data.token; this.loadMachines(false); this.touch(); },
      error: err => { d.working = false; d.error = err.error?.message || 'Could not create token'; this.touch(); }
    });
  }
  revokeToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (!d.confirmRevoke) { d.confirmRevoke = true; return; }
    d.working = true;
    this.programs.revokeDeviceToken(d.machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { d.working = false; this.toast.success('Device token revoked'); this.closeDevice(); this.touch(); },
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
