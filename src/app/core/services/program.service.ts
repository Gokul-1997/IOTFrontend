import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/** A machine as Program Transfer sees it: its folder and its device. */
export interface PtMachine {
  id: number;
  machine_serial_no: string;
  ip_address: string | null;
  folder: string;
  device_id: number | null;
  token_prefix: string | null;
  device_label: string | null;
  device_created_at: string | null;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  agent_version: string | null;
  online: boolean;
  open_jobs: number;
  controller_reported_at: string | null;
}

export type PtKind = 'NEW' | 'BACKUP' | 'FETCHED';

export interface PtFile {
  id: number;
  machine_id: number;
  machine_serial_no: string;
  folder: string;
  stored_name: string;
  program_name: string;
  kind: PtKind;
  size_bytes: number;
  sha256: string;
  note: string | null;
  job_id: number | null;
  created_at: string;
  uploaded_by_name: string | null;
}

export type PtStatus = 'QUEUED' | 'DELIVERED' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface PtJob {
  id: number;
  machine_id: number;
  machine_serial: string;
  action: 'SEND' | 'FETCH';
  program_name: string;
  overwrite: boolean;
  status: PtStatus;
  message: string | null;
  file_id: number | null;
  file_name: string | null;
  backup_file_id: number | null;
  backup_name: string | null;
  file_size: number | null;
  requested_by_name: string | null;
  requested_at: string;
  delivered_at: string | null;
  finished_at: string | null;
}

export interface PtControllerFile { name: string; size: number | null; modified: string | null; comment: string | null; }

/**
 * Program Transfer. Programs live in the server's ProgramTransfer folder,
 * one folder per machine; the machine's own device collects the jobs made
 * here (send a program, fetch one) and reports back. The server never
 * connects to a controller.
 */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient) {}

  getMachines() {
    return this.http.get<{ data: PtMachine[] }>(`${this.api}/machines`);
  }

  /** What the device last reported is on the controller. */
  getControllerFiles(machineId: number) {
    return this.http.get<{ data: { files: PtControllerFile[]; reported_at: string | null } }>(
      `${this.api}/machines/${machineId}/controller-files`);
  }

  getFiles(params: { machine_id?: number | null; kind?: string; search?: string; page?: number; limit?: number }) {
    const query: any = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') query[k] = v;
    return this.http.get<{ data: PtFile[]; total: number }>(`${this.api}/files`, { params: query });
  }

  /** A new program into the machine's folder; with send, queued for its device at once. */
  upload(input: { file: File; machineId: number; programName?: string; note?: string; send: boolean; overwrite?: boolean }) {
    const form = new FormData();
    form.append('machine_id', String(input.machineId));
    if (input.programName) form.append('program_name', input.programName);
    if (input.note) form.append('note', input.note);
    form.append('send', String(input.send));
    form.append('overwrite', String(!!input.overwrite));
    form.append('file', input.file);
    return this.http.post<{ data: { file: PtFile; job: PtJob | null }; message: string }>(`${this.api}/files`, form);
  }

  download(id: number) {
    return this.http.get(`${this.api}/files/${id}/download`, { responseType: 'blob' });
  }

  delete(id: number) {
    return this.http.delete<any>(`${this.api}/files/${id}`);
  }

  /** Send files to machines. Without overwrite the API answers 409 FILE_EXISTS
   *  (with names) for a program the machine already holds. */
  send(fileIds: number[], machineIds: number[], overwrite = false) {
    return this.http.post<{ data: { jobs: PtJob[] } }>(`${this.api}/jobs`, {
      action: 'SEND', file_ids: fileIds, machine_ids: machineIds, overwrite
    });
  }

  /** Ask the machine's device for programs on its controller. */
  fetch(machineId: number, programNames: string[]) {
    return this.http.post<{ data: { jobs: PtJob[] } }>(`${this.api}/jobs`, {
      action: 'FETCH', machine_id: machineId, program_names: programNames
    });
  }

  getJobs(params: { machine_id?: number | null; status?: string; action?: string; page?: number; limit?: number } = {}) {
    const query: any = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') query[k] = v;
    return this.http.get<{ data: PtJob[]; total: number }>(`${this.api}/jobs`, { params: query });
  }

  cancelJob(id: number) {
    return this.http.post<{ data: PtJob }>(`${this.api}/jobs/${id}/cancel`, {});
  }

  /** A new token for the machine's device; the old one stops working. Shown once. */
  createDeviceToken(machineId: number, label?: string) {
    return this.http.post<{ data: { token: string; device: any } }>(`${this.api}/machines/${machineId}/device-token`, { label });
  }

  revokeDeviceToken(machineId: number) {
    return this.http.delete<any>(`${this.api}/machines/${machineId}/device-token`);
  }

  /** The server address a device is configured with (the API address without /api). */
  get serverUrl(): string {
    return environment.apiUrl.replace(/\/api\/?$/, '');
  }
}
