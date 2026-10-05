import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ProgramService, PtMachine, PtFile, PtJob, PtControllerFile, PtKind, PtStatus
} from '../../core/services/program.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { SocketService } from '../../core/services/socket.service';
import { UiTabsDirective } from '../../shared/ui-tabs.directive';
import { MatIconModule } from '@angular/material/icon';

const POLL_MS = 10_000;

/**
 * Program Transfer, through each machine's own device.
 *
 * The server keeps the programs (the ProgramTransfer folder, one folder per
 * machine IP) and hands out jobs; the device at the machine collects them,
 * writes to or reads from the controller, and reports back. So "send" here
 * queues a job and the status follows it: Waiting for the device → Taken by
 * the device → Done / Failed. The device also reports what is on the
 * controller, which is the "On the machine" list.
 */
@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule, UiTabsDirective, MatIconModule],
  templateUrl: './programs.component.html',
  styleUrl: './programs.component.scss'
})
export class ProgramsComponent implements OnInit, OnDestroy {
  tab: 'programs' | 'history' = 'programs';

  machines: PtMachine[] = [];
  selectedMachineId: number | null = null;

  /* ── the machine's folder ── */
  files: PtFile[] = [];
  filesTotal = 0;
  filesPage = 1;
  readonly filesLimit = 25;
  kind: '' | PtKind = '';
  search = '';
  loadingFiles = false;
  selectedFileIds = new Set<number>();

  /* ── the controller, as the device reported it ── */
  controllerFiles: PtControllerFile[] = [];
  controllerReportedAt: string | null = null;
  controllerSearch = '';
  loadingController = false;

  /* ── jobs ── */
  openJobs: PtJob[] = [];
  history: PtJob[] = [];
  historyTotal = 0;
  historyPage = 1;
  readonly historyLimit = 20;
  loadingHistory = false;
  busy = false;

  /* ── upload dialog ── */
  showUpload = false;
  uploadFile: File | null = null;
  uploadName = '';
  uploadNote = '';
  uploadSend = true;
  uploadMachineId: number | null = null;
  uploading = false;

  /** a send the machine refused because the program is already there */
  overwritePrompt: { names: string[]; retry: (overwrite: boolean) => void } | null = null;

  /* ── device token dialog ── */
  deviceDialog: {
    machine: PtMachine;
    label: string;
    token: string | null;
    confirmReplace: boolean;
    confirmRevoke: boolean;
    working: boolean;
    copied: boolean;
  } | null = null;

  private timer: any = null;
  now = Date.now();

  constructor(
    private programs: ProgramService,
    private toast: ToastService,
    private socket: SocketService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /* Each action shows only when the role holds it — what the API checks. */
  get canUpload():   boolean { return this.auth.hasAction('programs', 'upload'); }
  get canTransfer(): boolean { return this.auth.hasAction('programs', 'transfer'); }
  get canFetch():    boolean { return this.auth.hasAction('programs', 'fetch'); }
  get canDelete():   boolean { return this.auth.hasAction('programs', 'delete'); }
  /** a device token is a machine credential, like its MQTT key */
  get canManageDevice(): boolean { return this.auth.hasAction('machines', 'edit'); }

  /** The app is zoneless: every async callback says it changed something. */
  private touch() { this.cdr.markForCheck(); }

  ngOnInit() {
    this.loadMachines(true);
    this.socket.onProgramJob(() => this.refreshAfterJob());
    // device online/offline and job states move on their own: keep up
    this.timer = setInterval(() => {
      if (document.hidden) return;
      this.now = Date.now();
      this.loadMachines(false);
      if (this.selectedMachineId) this.loadOpenJobs();
      this.touch();
    }, POLL_MS);
  }

  ngOnDestroy() {
    this.socket.offProgramJob();
    if (this.timer) clearInterval(this.timer);
  }

  /* ─────────────── machines ─────────────── */

  get selectedMachine(): PtMachine | null {
    return this.machines.find(m => m.id === this.selectedMachineId) || null;
  }

  loadMachines(first: boolean) {
    this.programs.getMachines().subscribe({
      next: res => {
        this.machines = res.data || [];
        if (first && !this.selectedMachineId && this.machines.length) {
          this.selectedMachineId = this.machines[0].id;
          this.onMachineChange();
        }
        this.touch();
      },
      error: err => { if (first) this.toast.error(err.error?.message || 'Could not load the machines'); this.touch(); }
    });
  }

  onMachineChange() {
    this.selectedFileIds.clear();
    this.filesPage = 1;
    this.controllerFiles = [];
    this.controllerReportedAt = null;
    this.loadFiles();
    this.loadController();
    this.loadOpenJobs();
    if (this.tab === 'history') this.loadHistory();
  }

  /** "online", "offline" or "none" — a device that called in the last minute is online. */
  deviceState(m: PtMachine | null): 'online' | 'offline' | 'none' {
    if (!m || !m.device_id) return 'none';
    return m.online ? 'online' : 'offline';
  }

  ago(iso: string | null): string {
    if (!iso) return 'never';
    const s = Math.max(0, Math.round((this.now - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  /* ─────────────── the folder ─────────────── */

  loadFiles() {
    if (!this.selectedMachineId) { this.files = []; this.filesTotal = 0; return; }
    this.loadingFiles = true;
    this.programs.getFiles({
      machine_id: this.selectedMachineId, kind: this.kind, search: this.search.trim(),
      page: this.filesPage, limit: this.filesLimit
    }).subscribe({
      next: res => { this.files = res.data || []; this.filesTotal = res.total || 0; this.loadingFiles = false; this.touch(); },
      error: err => { this.loadingFiles = false; this.toast.error(err.error?.message || 'Could not load the programs'); this.touch(); }
    });
  }

  setKind(k: '' | PtKind) { this.kind = k; this.filesPage = 1; this.selectedFileIds.clear(); this.loadFiles(); }

  get filesPages(): number { return Math.max(1, Math.ceil(this.filesTotal / this.filesLimit)); }
  changeFilesPage(step: number) { this.filesPage = Math.min(this.filesPages, Math.max(1, this.filesPage + step)); this.loadFiles(); }

  isSelected(id: number) { return this.selectedFileIds.has(id); }
  toggleFile(id: number) { this.selectedFileIds.has(id) ? this.selectedFileIds.delete(id) : this.selectedFileIds.add(id); }
  get allSelected() { return this.files.length > 0 && this.files.every(f => this.selectedFileIds.has(f.id)); }
  toggleAll() {
    if (this.allSelected) this.files.forEach(f => this.selectedFileIds.delete(f.id));
    else this.files.forEach(f => this.selectedFileIds.add(f.id));
  }
  get selectedCount() { return this.selectedFileIds.size; }

  kindLabel(k: PtKind) { return k === 'NEW' ? 'Uploaded' : k === 'BACKUP' ? 'Backup' : 'From machine'; }
  kindBadge(k: PtKind) { return k === 'NEW' ? 'mexa-badge-violet' : k === 'BACKUP' ? 'mexa-badge-neutral' : 'mexa-badge-info'; }
  kindIcon(k: PtKind) { return k === 'NEW' ? 'upload_file' : k === 'BACKUP' ? 'inventory_2' : 'south_west'; }

  fileSize(bytes: number | null | undefined): string {
    if (bytes == null) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  download(f: PtFile) {
    this.programs.download(f.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.stored_name;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => { this.toast.error('Download failed — the file may have been removed from the folder'); this.touch(); }
    });
  }

  deleteFile(f: PtFile) {
    if (!confirm(`Delete ${f.stored_name} from the ProgramTransfer folder?`)) return;
    this.programs.delete(f.id).subscribe({
      next: () => { this.toast.success('Program deleted'); this.selectedFileIds.delete(f.id); this.loadFiles(); },
      error: err => { this.toast.error(err.error?.message || 'Delete failed'); this.touch(); }
    });
  }

  /* ─────────────── sending and fetching ─────────────── */

  sendSelected(overwrite = false) {
    const machine = this.selectedMachine;
    if (!machine || !this.selectedCount) return;
    const ids = [...this.selectedFileIds];
    this.busy = true;
    this.programs.send(ids, [machine.id], overwrite).subscribe({
      next: res => {
        this.busy = false;
        this.overwritePrompt = null;
        this.selectedFileIds.clear();
        const n = res.data.jobs.length;
        this.toast.success(`${n} program${n === 1 ? '' : 's'} queued for ${machine.machine_serial_no}`);
        this.loadOpenJobs();
        this.touch();
      },
      error: err => {
        this.busy = false;
        if (err.status === 409 && err.error?.code === 'FILE_EXISTS') {
          this.overwritePrompt = { names: err.error.names || [], retry: o => this.sendSelected(o) };
        } else {
          this.overwritePrompt = null;
          this.toast.error(err.error?.message || 'Could not queue the programs');
        }
        this.touch();
      }
    });
  }

  get filteredController(): PtControllerFile[] {
    const q = this.controllerSearch.trim().toLowerCase();
    return q ? this.controllerFiles.filter(f => f.name.toLowerCase().includes(q)) : this.controllerFiles;
  }

  loadController() {
    const id = this.selectedMachineId;
    if (!id) return;
    this.loadingController = true;
    this.programs.getControllerFiles(id).subscribe({
      next: res => {
        if (id !== this.selectedMachineId) return;
        this.controllerFiles = res.data.files || [];
        this.controllerReportedAt = res.data.reported_at;
        this.loadingController = false;
        this.touch();
      },
      error: () => { this.loadingController = false; this.touch(); }
    });
  }

  /** a fetch already asked for and not finished */
  fetchWaiting(name: string): boolean {
    return this.openJobs.some(j => j.action === 'FETCH' && j.program_name.toLowerCase() === name.toLowerCase());
  }

  fetchFile(f: PtControllerFile) {
    const machine = this.selectedMachine;
    if (!machine) return;
    this.programs.fetch(machine.id, [f.name]).subscribe({
      next: () => { this.toast.success(`Asked ${machine.machine_serial_no} for ${f.name}`); this.loadOpenJobs(); this.touch(); },
      error: err => { this.toast.error(err.error?.message || 'Could not ask the machine'); this.touch(); }
    });
  }

  /* ─────────────── jobs ─────────────── */

  loadOpenJobs() {
    const id = this.selectedMachineId;
    if (!id) { this.openJobs = []; return; }
    this.programs.getJobs({ machine_id: id, status: 'open', limit: 50 }).subscribe({
      next: res => { if (id === this.selectedMachineId) { this.openJobs = res.data || []; this.touch(); } },
      error: () => {}
    });
  }

  /** a job moved: what it touched may have changed too */
  private refreshAfterJob() {
    this.loadOpenJobs();
    this.loadFiles();
    this.loadController();
    this.loadMachines(false);
    if (this.tab === 'history') this.loadHistory();
  }

  cancelJob(j: PtJob) {
    this.programs.cancelJob(j.id).subscribe({
      next: () => { this.toast.success('Cancelled'); this.loadOpenJobs(); this.touch(); },
      error: err => { this.toast.error(err.error?.message || 'Could not cancel'); this.loadOpenJobs(); this.touch(); }
    });
  }

  statusLabel(j: PtJob): string {
    const s: Record<PtStatus, string> = {
      QUEUED: 'Waiting for the device', DELIVERED: 'Taken by the device', DONE: 'Done',
      FAILED: 'Failed', CANCELLED: 'Cancelled'
    };
    return s[j.status];
  }
  statusBadge(s: PtStatus) {
    return s === 'DONE' ? 'mexa-badge-good' : s === 'FAILED' ? 'mexa-badge-bad' : s === 'CANCELLED' ? 'mexa-badge-neutral' : 'mexa-badge-warn';
  }
  statusIcon(s: PtStatus) {
    return s === 'DONE' ? 'check_circle' : s === 'FAILED' ? 'error_outline' : s === 'CANCELLED' ? 'block' : s === 'DELIVERED' ? 'sync' : 'schedule';
  }

  switchTab(t: 'programs' | 'history') {
    this.tab = t;
    if (t === 'history') { this.historyPage = 1; this.loadHistory(); }
  }

  loadHistory() {
    this.loadingHistory = true;
    this.programs.getJobs({ machine_id: this.selectedMachineId, page: this.historyPage, limit: this.historyLimit }).subscribe({
      next: res => { this.history = res.data || []; this.historyTotal = res.total || 0; this.loadingHistory = false; this.touch(); },
      error: err => { this.loadingHistory = false; this.toast.error(err.error?.message || 'Could not load the history'); this.touch(); }
    });
  }
  get historyPages(): number { return Math.max(1, Math.ceil(this.historyTotal / this.historyLimit)); }
  changeHistoryPage(step: number) { this.historyPage = Math.min(this.historyPages, Math.max(1, this.historyPage + step)); this.loadHistory(); }

  /* ─────────────── upload ─────────────── */

  openUpload() {
    this.uploadFile = null;
    this.uploadName = '';
    this.uploadNote = '';
    this.uploadSend = this.canTransfer;
    this.uploadMachineId = this.selectedMachineId;
    this.showUpload = true;
  }

  onFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    this.uploadFile = input.files?.[0] || null;
    if (this.uploadFile && !this.uploadName) this.uploadName = this.uploadFile.name;
  }

  get uploadMachine(): PtMachine | null {
    return this.machines.find(m => m.id === this.uploadMachineId) || null;
  }

  upload(overwrite = false) {
    if (!this.uploadFile || !this.uploadMachineId) return;
    const machine = this.uploadMachine;
    this.uploading = true;
    this.programs.upload({
      file: this.uploadFile, machineId: this.uploadMachineId, programName: this.uploadName.trim(),
      note: this.uploadNote.trim(), send: this.uploadSend && this.canTransfer, overwrite
    }).subscribe({
      next: res => {
        this.uploading = false;
        this.showUpload = false;
        this.overwritePrompt = null;
        this.toast.success(res.data.job
          ? `Uploaded and queued for ${machine?.machine_serial_no}`
          : `Uploaded to ${machine?.machine_serial_no}'s folder`);
        if (this.uploadMachineId !== this.selectedMachineId) { this.selectedMachineId = this.uploadMachineId; this.onMachineChange(); }
        else { this.loadFiles(); this.loadOpenJobs(); }
        this.touch();
      },
      error: err => {
        this.uploading = false;
        if (err.status === 409 && err.error?.code === 'FILE_EXISTS') {
          this.overwritePrompt = { names: err.error.names || [], retry: o => this.upload(o) };
        } else {
          this.toast.error(err.error?.message || 'Upload failed');
        }
        this.touch();
      }
    });
  }

  cancelOverwrite() { this.overwritePrompt = null; }
  confirmOverwrite() { this.overwritePrompt?.retry(true); }

  /* ─────────────── the machine's device ─────────────── */

  openDevice() {
    const m = this.selectedMachine;
    if (!m) return;
    this.deviceDialog = { machine: m, label: m.device_label || '', token: null, confirmReplace: false, confirmRevoke: false, working: false, copied: false };
  }

  closeDevice() { this.deviceDialog = null; this.loadMachines(false); }

  createToken() {
    const d = this.deviceDialog;
    if (!d) return;
    if (d.machine.device_id && !d.confirmReplace) { d.confirmReplace = true; return; }
    d.working = true;
    this.programs.createDeviceToken(d.machine.id, d.label.trim() || undefined).subscribe({
      next: res => { d.working = false; d.confirmReplace = false; d.token = res.data.token; this.loadMachines(false); this.touch(); },
      error: err => { d.working = false; this.toast.error(err.error?.message || 'Could not create the token'); this.touch(); }
    });
  }

  revokeToken() {
    const d = this.deviceDialog;
    if (!d) return;
    if (!d.confirmRevoke) { d.confirmRevoke = true; return; }
    d.working = true;
    this.programs.revokeDeviceToken(d.machine.id).subscribe({
      next: () => { this.toast.success(`${d.machine.machine_serial_no}'s device token revoked`); this.closeDevice(); this.touch(); },
      error: err => { d.working = false; this.toast.error(err.error?.message || 'Could not revoke the token'); this.touch(); }
    });
  }

  /** what goes into the device's config file */
  deviceConfig(token: string): string {
    return `MEXA_URL=${this.programs.serverUrl}\nMEXA_DEVICE_TOKEN=${token}`;
  }

  copyConfig() {
    const d = this.deviceDialog;
    if (!d?.token) return;
    navigator.clipboard?.writeText(this.deviceConfig(d.token)).then(
      () => { d.copied = true; this.touch(); },
      () => this.toast.error('Copy did not work — select the text and copy it')
    );
  }
}
