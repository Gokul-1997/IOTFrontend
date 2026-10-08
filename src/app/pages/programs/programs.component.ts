import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
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
  styleUrl: './programs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgramsComponent implements OnInit, OnDestroy {
  tab: 'send' | 'get' | 'history' = 'send';

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
  recentJobs: PtJob[] = [];
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
  overwritePrompt: { names: string[]; machineLabel: string; retry: (overwrite: boolean) => void } | null = null;

  /* ── the machine's program path (where its device saves programs) ── */
  editingPath = false;
  pathDraft = '';
  savingPath = false;
  pathError = '';

  /* ── device token dialog ── */
  deviceDialog: {
    machine: PtMachine;
    label: string;
    path: string;
    token: string | null;
    confirmReplace: boolean;
    confirmRevoke: boolean;
    working: boolean;
    copied: boolean;
    showHelp: boolean;
    sampleTab: 'curl' | 'python';
    sampleCopied: boolean;
    error: string;
  } | null = null;

  private timer: any = null;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private readonly destroy$ = new Subject<void>();
  private readonly pendingFetch = new Set<string>();
  private versions = { machines: 0, files: 0, controller: 0, open: 0, recent: 0, history: 0 };
  private visibilityChanged = () => { if (!document.hidden) this.refreshAfterJob(); };
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
    this.unsubscribeJobs = this.socket.onProgramJob(job => {
      if (document.hidden || (job?.machine_id && Number(job.machine_id) !== this.selectedMachineId)) return;
      // A batch of jobs can emit many events; refresh once for the batch.
      if (!this.refreshTimer) this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        this.refreshAfterJob();
      }, 250);
    });
    this.socket.connected$.pipe(takeUntil(this.destroy$)).subscribe(() => this.refreshAfterJob());
    void this.socket.connect().catch(() => { /* HTTP polling continues while reconnecting. */ });
    document.addEventListener('visibilitychange', this.visibilityChanged);
    // device online/offline and job states move on their own: keep up
    this.timer = setInterval(() => {
      if (document.hidden) return;
      this.now = Date.now();
      this.loadMachines(false);
      if (this.selectedMachineId) {
        this.loadOpenJobs();
        if (this.tab === 'get') this.loadController();
        if (this.tab === 'history') this.loadHistory();
      }
      this.touch();
    }, POLL_MS);
  }

  private unsubscribeJobs?: () => void;

  ngOnDestroy() {
    this.unsubscribeJobs?.();
    if (this.timer) clearInterval(this.timer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* ─────────────── machines ─────────────── */

  get selectedMachine(): PtMachine | null {
    return this.machines.find(m => m.id === this.selectedMachineId) || null;
  }

  loadMachines(first: boolean) {
    const version = ++this.versions.machines;
    this.programs.getMachines().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.machines) return;
        this.machines = res.data || [];
        if (!this.selectedMachineId && this.machines.length) {
          this.selectedMachineId = this.machines[0].id;
          this.onMachineChange();
        }
        if (this.selectedMachineId && !this.selectedMachine) {
          this.selectedMachineId = this.machines[0]?.id ?? null;
          this.onMachineChange();
        }
        this.touch();
      },
      error: err => { if (first && version === this.versions.machines) this.toast.error(err.error?.message || 'Could not load the machines'); this.touch(); }
    });
  }

  onMachineChange() {
    for (const key of ['files', 'controller', 'open', 'recent', 'history'] as const) this.versions[key]++;
    this.selectedFileIds.clear();
    this.filesPage = 1;
    this.files = [];
    this.filesTotal = 0;
    this.loadingFiles = false;
    this.loadingController = false;
    this.loadingHistory = false;
    this.openJobs = [];
    this.recentJobs = [];
    this.history = [];
    this.historyTotal = 0;
    this.historyPage = 1;
    this.editingPath = false;
    this.pathDraft = '';
    this.pathError = '';
    this.controllerSearch = '';
    this.controllerFiles = [];
    this.controllerReportedAt = null;
    this.loadFiles();
    this.loadController();
    this.loadOpenJobs();
    if (this.tab === 'history') this.loadHistory();
  }

  /** every machine must say where its device saves programs before anything moves */
  get hasPath(): boolean { return !!this.selectedMachine?.program_path; }

  startPathEdit() {
    this.pathDraft = this.selectedMachine?.program_path || '';
    this.pathError = '';
    this.editingPath = true;
  }

  cancelPathEdit() { this.editingPath = false; this.pathError = ''; }

  savePath() {
    const m = this.selectedMachine;
    const path = this.pathDraft.trim();
    if (!m || !this.canManageDevice || this.savingPath) return;
    if (!path) { this.pathError = 'Enter the folder on the machine, e.g. //CNC_MEM/USER/PATH1/'; return; }
    this.savingPath = true;
    this.programs.setProgramPath(m.id, path).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savingPath = false;
        if (m.id === this.selectedMachineId) this.editingPath = false;
        m.program_path = path;
        this.toast.success(`Program path set for ${m.machine_serial_no}`);
        this.loadMachines(false);
        this.touch();
      },
      error: err => {
        this.savingPath = false;
        if (m.id === this.selectedMachineId) this.pathError = err.error?.message || 'Could not save the path';
        this.touch();
      }
    });
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
    const version = ++this.versions.files;
    if (!this.selectedMachineId) { this.files = []; this.filesTotal = 0; return; }
    this.loadingFiles = true;
    this.programs.getFiles({
      machine_id: this.selectedMachineId, kind: this.kind, search: this.search.trim(),
      page: this.filesPage, limit: this.filesLimit
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.files) return;
        this.files = res.data || []; this.filesTotal = res.total || 0; this.loadingFiles = false; this.touch();
      },
      error: err => {
        if (version !== this.versions.files) return;
        this.loadingFiles = false; this.toast.error(err.error?.message || 'Could not load the programs'); this.touch();
      }
    });
  }

  setKind(k: '' | PtKind) { this.kind = k; this.filesPage = 1; this.selectedFileIds.clear(); this.loadFiles(); }

  get filesPages(): number { return Math.max(1, Math.ceil(this.filesTotal / this.filesLimit)); }
  changeFilesPage(step: number) { this.filesPage = Math.min(this.filesPages, Math.max(1, this.filesPage + step)); this.selectedFileIds.clear(); this.loadFiles(); }

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
    this.downloadFile(f.id, f.stored_name);
  }

  downloadJob(j: PtJob) {
    if (j.status === 'DONE' && j.action === 'FETCH' && j.file_id) this.downloadFile(j.file_id, j.file_name || j.program_name);
  }

  private downloadFile(id: number, name: string) {
    this.programs.download(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => { this.toast.error('Download failed — the file may have been removed from the folder'); this.touch(); }
    });
  }

  deleteFile(f: PtFile) {
    if (!confirm(`Delete ${f.stored_name} from the ProgramTransfer folder?`)) return;
    this.programs.delete(f.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.toast.success('Program deleted'); this.selectedFileIds.delete(f.id); this.loadFiles(); },
      error: err => { this.toast.error(err.error?.message || 'Delete failed'); this.touch(); }
    });
  }

  /* ─────────────── sending and fetching ─────────────── */

  sendSelected() {
    this.sendFiles([...this.selectedFileIds]);
  }

  sendFile(f: PtFile) {
    if (f.machine_id === this.selectedMachineId) this.sendFiles([f.id]);
  }

  private sendFiles(ids: number[]) {
    const machine = this.selectedMachine;
    if (!machine || !machine.device_id || !ids.length || !this.canTransfer || this.busy || this.overwritePrompt) return;
    if (!machine.program_path) { this.toast.error(`Set the program path for ${machine.machine_serial_no} first`); return; }
    this.queueSend(machine, ids, false);
  }

  // Keep the original machine and files even if the selection changes during a request.
  private queueSend(machine: PtMachine, ids: number[], overwrite: boolean) {
    this.busy = true;
    this.programs.send(ids, [machine.id], overwrite).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.busy = false;
        this.overwritePrompt = null;
        if (this.selectedMachineId === machine.id) ids.forEach(id => this.selectedFileIds.delete(id));
        const n = res.data.jobs.length;
        this.toast.success(`${n} program${n === 1 ? '' : 's'} queued for ${machine.machine_serial_no}`);
        this.loadOpenJobs();
        this.touch();
      },
      error: err => {
        this.busy = false;
        if (err.status === 409 && err.error?.code === 'FILE_EXISTS') {
          this.overwritePrompt = { names: err.error.names || [], machineLabel: machine.machine_serial_no,
            retry: o => this.queueSend(machine, ids, o) };
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
    const version = ++this.versions.controller;
    const id = this.selectedMachineId;
    if (!id) return;
    this.loadingController = true;
    this.programs.getControllerFiles(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.controller) return;
        this.controllerFiles = res.data.files || [];
        this.controllerReportedAt = res.data.reported_at;
        this.loadingController = false;
        this.touch();
      },
      error: () => { if (version === this.versions.controller) { this.loadingController = false; this.touch(); } }
    });
  }

  /** a fetch already asked for and not finished */
  fetchWaiting(name: string): boolean {
    return this.pendingFetch.has(`${this.selectedMachineId}:${name.toLowerCase()}`) ||
      this.openJobs.some(j => j.action === 'FETCH' && j.program_name.toLowerCase() === name.toLowerCase());
  }

  fetchFile(f: PtControllerFile) {
    const machine = this.selectedMachine;
    if (!machine || !machine.device_id || !machine.program_path || !this.canFetch || this.fetchWaiting(f.name)) return;
    const key = `${machine.id}:${f.name.toLowerCase()}`;
    this.pendingFetch.add(key);
    this.programs.fetch(machine.id, [f.name]).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.pendingFetch.delete(key);
        if (machine.id === this.selectedMachineId) {
          const jobs = res.data.jobs.filter(j => j.status === 'QUEUED' || j.status === 'DELIVERED');
          this.openJobs = [...this.openJobs.filter(j => !jobs.some(next => next.id === j.id)), ...jobs];
        }
        this.toast.success(`Queued ${f.name} from ${machine.machine_serial_no}. Download it when the transfer is done.`);
        this.loadOpenJobs(); this.touch();
      },
      error: err => { this.pendingFetch.delete(key); this.toast.error(err.error?.message || 'Could not ask the machine'); this.touch(); }
    });
  }

  /* ─────────────── jobs ─────────────── */

  loadOpenJobs() {
    const version = ++this.versions.open;
    const id = this.selectedMachineId;
    if (!id) { this.openJobs = []; return; }
    this.programs.getJobs({ machine_id: id, status: 'open', limit: 50 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.open) return;
        const next = res.data || [];
        const finished = this.openJobs.some(j => !next.some(current => current.id === j.id));
        this.openJobs = next;
        if (finished) this.refreshFilesAfterCompletion();
        this.touch();
      },
      error: () => {}
    });
    this.loadRecentJobs();
  }

  private loadRecentJobs() {
    const version = ++this.versions.recent;
    const id = this.selectedMachineId;
    if (!id) return;
    this.programs.getJobs({ machine_id: id, limit: 5 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.recent) return;
        const next = res.data || [];
        if (next.some(j => (j.status === 'DONE' || j.status === 'FAILED') &&
          !this.recentJobs.some(previous => previous.id === j.id && previous.status === j.status))) {
          this.refreshFilesAfterCompletion();
        }
        this.recentJobs = next;
        this.touch();
      },
      error: () => {}
    });
  }

  private refreshFilesAfterCompletion() {
    this.loadFiles();
    this.loadController();
    if (this.tab === 'history') this.loadHistory();
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
    if (j.status !== 'QUEUED' || !(j.action === 'SEND' ? this.canTransfer : this.canFetch)) return;
    this.programs.cancelJob(j.id).pipe(takeUntil(this.destroy$)).subscribe({
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

  switchTab(t: 'send' | 'get' | 'history') {
    this.tab = t;
    if (t === 'history') { this.historyPage = 1; this.loadHistory(); }
    if (t === 'get') this.loadController();
    if (t === 'send') this.loadFiles();
  }

  loadHistory() {
    const version = ++this.versions.history;
    if (!this.selectedMachineId) { this.history = []; this.historyTotal = 0; this.loadingHistory = false; return; }
    this.loadingHistory = true;
    this.programs.getJobs({ machine_id: this.selectedMachineId, page: this.historyPage, limit: this.historyLimit }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (version !== this.versions.history) return;
        this.history = res.data || []; this.historyTotal = res.total || 0; this.loadingHistory = false; this.touch();
      },
      error: err => {
        if (version !== this.versions.history) return;
        this.loadingHistory = false; this.toast.error(err.error?.message || 'Could not load the history'); this.touch();
      }
    });
  }
  get historyPages(): number { return Math.max(1, Math.ceil(this.historyTotal / this.historyLimit)); }
  changeHistoryPage(step: number) { this.historyPage = Math.min(this.historyPages, Math.max(1, this.historyPage + step)); this.loadHistory(); }

  /* ─────────────── upload ─────────────── */

  openUpload() {
    if (!this.canUpload || !this.selectedMachine || this.uploading || this.overwritePrompt) return;
    this.uploadFile = null;
    this.uploadName = '';
    this.uploadNote = '';
    this.uploadSend = this.canTransfer && this.hasPath && !!this.selectedMachine?.device_id;
    this.uploadMachineId = this.selectedMachineId;
    this.showUpload = true;
  }

  closeUpload() {
    if (!this.uploading && !this.overwritePrompt) this.showUpload = false;
  }

  onFileSelected(e: Event) {
    if (this.uploading || this.overwritePrompt) return;
    const input = e.target as HTMLInputElement;
    const previousName = this.uploadFile?.name;
    this.uploadFile = input.files?.[0] || null;
    if (!this.uploadName || this.uploadName === previousName) this.uploadName = this.uploadFile?.name || '';
  }

  get uploadMachine(): PtMachine | null {
    return this.machines.find(m => m.id === this.uploadMachineId) || null;
  }

  /** where the device will save it, for the upload dialog */
  get uploadTarget(): string | null {
    const path = this.uploadMachine?.program_path;
    const name = (this.uploadName || this.uploadFile?.name || '').trim();
    if (!path || !name) return null;
    return /[\\/]$/.test(path) ? path + name : path + (path.includes('\\') && !path.includes('/') ? '\\' : '/') + name;
  }

  upload() {
    if (!this.uploadFile || !this.uploadMachineId || !this.canUpload || this.uploading || this.overwritePrompt) return;
    const machine = this.uploadMachine;
    if (!machine) return;
    const request = {
      file: this.uploadFile, machineId: this.uploadMachineId, programName: this.uploadName.trim(),
      note: this.uploadNote.trim(), send: this.uploadSend && this.canTransfer && !!machine.program_path && !!machine.device_id
    };
    this.uploadRequest(machine, request, false);
  }

  private uploadRequest(machine: PtMachine, request: Parameters<ProgramService['upload']>[0], overwrite: boolean) {
    this.uploading = true;
    this.programs.upload({ ...request, overwrite }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.uploading = false;
        this.showUpload = false;
        this.overwritePrompt = null;
        this.toast.success(res.data.job
          ? `Uploaded and queued for ${machine?.machine_serial_no}`
          : `Uploaded to ${machine?.machine_serial_no}'s folder`);
        if (machine.id === this.selectedMachineId) { this.loadFiles(); this.loadOpenJobs(); }
        this.touch();
      },
      error: err => {
        this.uploading = false;
        if (err.status === 409 && err.error?.code === 'FILE_EXISTS') {
          this.overwritePrompt = { names: err.error.names || [], machineLabel: machine.machine_serial_no,
            retry: o => this.uploadRequest(machine, request, o) };
        } else {
          this.overwritePrompt = null;
          this.toast.error(err.error?.message || 'Upload failed');
        }
        this.touch();
      }
    });
  }

  cancelOverwrite() { if (!this.busy && !this.uploading) this.overwritePrompt = null; }
  confirmOverwrite() { if (!this.busy && !this.uploading) this.overwritePrompt?.retry(true); }

  /* ─────────────── the machine's device ─────────────── */

  openDevice() {
    const m = this.selectedMachine;
    if (!m) return;
    this.deviceDialog = {
      machine: m, label: m.device_label || '', path: m.program_path || '', token: null,
      confirmReplace: false, confirmRevoke: false, working: false, copied: false,
      showHelp: false, sampleTab: 'python', sampleCopied: false, error: ''
    };
  }

  closeDevice() {
    if (this.deviceDialog?.working) return;
    this.deviceDialog = null;
    this.loadMachines(false);
  }

  createToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (d.machine.device_id && !d.confirmReplace) { d.confirmReplace = true; return; }
    const path = d.path.trim();
    if (!d.machine.program_path && !path) { d.error = 'Set the program path first — where the device saves programs on this machine.'; return; }
    d.error = '';
    d.working = true;
    const issue = () => this.programs.createDeviceToken(d.machine.id, d.label.trim() || undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        d.working = false; d.confirmReplace = false; d.token = res.data.token; d.showHelp = true;
        this.loadMachines(false); this.touch();
      },
      error: err => { d.working = false; d.error = err.error?.message || 'Could not create the token'; this.touch(); }
    });
    // a machine without a path gets it first, in the same step
    if (!d.machine.program_path) {
      this.programs.setProgramPath(d.machine.id, path).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => { d.machine.program_path = path; issue(); },
        error: err => { d.working = false; d.error = err.error?.message || 'Could not save the path'; this.touch(); }
      });
    } else {
      issue();
    }
  }

  revokeToken() {
    const d = this.deviceDialog;
    if (!d || d.working || !this.canManageDevice) return;
    if (!d.confirmRevoke) { d.confirmRevoke = true; return; }
    d.working = true;
    this.programs.revokeDeviceToken(d.machine.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { d.working = false; this.toast.success(`${d.machine.machine_serial_no}'s device token revoked`); this.closeDevice(); this.touch(); },
      error: err => { d.working = false; this.toast.error(err.error?.message || 'Could not revoke the token'); this.touch(); }
    });
  }

  /** what goes into the device's config file */
  deviceConfig(token: string): string {
    return `MEXA_URL=${this.programs.serverUrl}\nMEXA_DEVICE_TOKEN=${token}`;
  }

  /** Every call the device makes, filled in with this machine's values (the token only right after it is made). */
  sample(kind: 'curl' | 'python'): string {
    const d = this.deviceDialog;
    const token = d?.token || 'mxd_PASTE-THE-TOKEN';
    const path = d?.machine.program_path || d?.path.trim() || '//CNC_MEM/USER/PATH1/';
    const api = `${this.programs.serverUrl}/api/device/v1`;
    if (kind === 'curl') {
      return [
        `URL=${api}`,
        `AUTH="Authorization: Bearer ${token}"`,
        ``,
        `# 1. Check the token - the answer has this machine's program path (${path})`,
        `curl -s -H "$AUTH" $URL/ping`,
        ``,
        `# 2. Ask for work every 15 s. HTTP 204 = nothing to do`,
        `curl -s -H "$AUTH" $URL/jobs/next`,
        ``,
        `# 3. NEW PROGRAM (action SEND, job 11): download it, check its sha256,`,
        `#    then save it on the machine at target_file (${path}O1234.nc)`,
        `curl -s -H "$AUTH" -o O1234.nc $URL/jobs/11/file`,
        ``,
        `# 4. BACKUP: before overwriting, upload what is in ${path} now`,
        `curl -s -H "$AUTH" -F type=BACKUP -F job_id=11 -F program_name=O1234.nc -F file=@O1234-on-machine.nc $URL/files`,
        ``,
        `# 5. Say how it went`,
        `curl -s -H "$AUTH" -H "Content-Type: application/json" -d '{"status":"DONE"}' $URL/jobs/11/result`,
        ``,
        `# 6. UPLOAD a program a user asked for (action FETCH, job 12) - read it from ${path}`,
        `curl -s -H "$AUTH" -F type=FETCHED -F job_id=12 -F file=@O2001.nc $URL/files`,
        ``,
        `# 7. What is in ${path} (every few minutes)`,
        `curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" -d '{"files":[{"name":"O1234.nc","size":2048}]}' $URL/controller-files`
      ].join('\n');
    }
    return [
      `import hashlib, json, time, urllib.request, uuid`,
      ``,
      `API = "${api}"`,
      `TOKEN = "${token}"`,
      ``,
      `def call(method, url, body=None, ctype=None):`,
      `    h = {"Authorization": "Bearer " + TOKEN}`,
      `    if ctype: h["Content-Type"] = ctype`,
      `    with urllib.request.urlopen(urllib.request.Request(API + url, body, h, method=method), timeout=120) as r:`,
      `        return r.status, r.read()`,
      ``,
      `def result(job, status, message=None):                 # 5. say how it went`,
      `    call("POST", "/jobs/%d/result" % job["id"], json.dumps({"status": status, "message": message}).encode(), "application/json")`,
      ``,
      `def upload(data, tag, name, job_id):                    # 4. BACKUP / 6. FETCHED: machine -> server`,
      `    b = uuid.uuid4().hex`,
      `    f = {"type": tag, "program_name": name, "job_id": str(job_id), "sha256": hashlib.sha256(data).hexdigest()}`,
      `    body = b"".join(('--%s\\r\\nContent-Disposition: form-data; name="%s"\\r\\n\\r\\n%s\\r\\n' % (b, k, v)).encode() for k, v in f.items())`,
      `    body += ('--%s\\r\\nContent-Disposition: form-data; name="file"; filename="%s"\\r\\n\\r\\n' % (b, name)).encode() + data + ("\\r\\n--%s--\\r\\n" % b).encode()`,
      `    call("POST", "/files", body, "multipart/form-data; boundary=" + b)`,
      ``,
      `info = json.loads(call("GET", "/ping")[1])               # 1. check the token`,
      `print(info["machine"]["serial"], info["machine"]["program_path"])   # ${path}`,
      ``,
      `while True:`,
      `    status, body = call("GET", "/jobs/next")             # 2. anything to do?`,
      `    if status == 204:`,
      `        time.sleep(info["poll_seconds"]); continue`,
      `    job = json.loads(body)["job"]`,
      `    path, name = job["program_path"], job["program_name"]`,
      `    if job["action"] == "SEND":                          # 3. NEW PROGRAM for the machine`,
      `        data = call("GET", "/jobs/%d/file" % job["id"])[1]`,
      `        if len(data) != job["file"]["size"] or hashlib.sha256(data).hexdigest() != job["file"]["sha256"]:`,
      `            result(job, "FAILED", "Download size or checksum mismatch"); continue`,
      `        old = read_from_machine(path, name)              # your FOCAS / FTP code`,
      `        if old is not None:`,
      `            if not job.get("overwrite", False):`,
      `                result(job, "FAILED", "Program exists; overwrite was not approved"); continue`,
      `            upload(old, "BACKUP", name, job["id"])       # 4. BACKUP first`,
      `        save_on_machine(path, name, data)                # your FOCAS / FTP code`,
      `        result(job, "DONE")`,
      `    else:                                                # 6. FETCH: a user asked for it`,
      `        data = read_from_machine(path, name)`,
      `        if data is None: result(job, "FAILED", name + " is not on the machine.")`,
      `        else: upload(data, "FETCHED", name, job["id"])   # finishes the job`
    ].join('\n');
  }

  copySample() {
    const d = this.deviceDialog;
    if (!d) return;
    navigator.clipboard?.writeText(this.sample(d.sampleTab)).then(
      () => { d.sampleCopied = true; this.touch(); setTimeout(() => { d.sampleCopied = false; this.touch(); }, 2000); },
      () => this.toast.error('Copy did not work — select the text and copy it')
    );
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
