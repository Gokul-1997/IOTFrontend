import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/** A machine as Program Transfer sees it: its folder and its device. */
export interface PtMachine {
  id: number;
  machine_serial_no: string;
  ip_address: string | null;
  /** where the machine's device saves programs on the machine, e.g. //CNC_MEM/USER/PATH1/ */
  program_path: string | null;
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
  is_current?: boolean;
}

/** The web publishes a current file; its device downloads it directly and uploads backups. */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient) {}

  getMachines() {
    return this.http.get<{ data: PtMachine[] }>(`${this.api}/machines`);
  }

  getCurrentProgram(machineId: number) {
    return this.http.get<{ data: { file: PtFile | null } }>(`${this.api}/machines/${machineId}/current-program`);
  }

  /** Publish a device download; this does not claim a job or execute a CNC program. */
  publishProgram(machineId: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ data: { file: PtFile } }>(`${this.api}/machines/${machineId}/current-program`, form);
  }

  getFiles(params: { machine_id?: number | null; kind?: string; search?: string; page?: number; limit?: number }) {
    const query: any = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') query[k] = v;
    return this.http.get<{ data: PtFile[]; total: number }>(`${this.api}/files`, { params: query });
  }

  download(id: number) {
    return this.http.get(`${this.api}/files/${id}/download`, { responseType: 'blob' });
  }

  delete(id: number) {
    return this.http.delete<any>(`${this.api}/files/${id}`);
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
