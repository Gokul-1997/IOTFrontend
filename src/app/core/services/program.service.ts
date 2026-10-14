import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { MasterDataService } from './master-data.service';

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

export interface PtJob {
  id: number; machine_id: number; action: 'SEND' | 'BACKUP'; program_name: string | null;
  status: 'QUEUED' | 'DELIVERED' | 'DONE' | 'FAILED' | 'CANCELLED';
  message: string | null; error_code: string | null; expires_at: string | null;
  requested_at: string; finished_at: string | null; file_id: number | null;
}
export interface PtStatus {
  machine: Pick<PtMachine, 'id' | 'ip_address' | 'program_path'> & Partial<Pick<PtMachine, 'device_id' | 'last_seen_at' | 'online'>>;
  file: PtFile | null; backup: PtFile | null; jobs: PtJob[];
}

/** Store a reference file and request a verified device transfer, or a fresh running-program backup. */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  getMachines() {
    return this.master.get('programMachines');
  }

  getStatus(machineId: number) {
    return this.http.get<{ data: PtStatus }>(`${this.api}/machines/${machineId}/status`);
  }

  saveConnection(machineId: number, connection: { ip_address: string; program_path: string }) {
    return this.http.put<{ data: { machine: PtStatus['machine'] } }>(`${this.api}/machines/${machineId}/connection`, connection);
  }
  transfer(machineId: number, file: File, requestKey: string, overwrite = false) {
    const form = new FormData();
    form.append('file', file);
    if (overwrite) form.append('overwrite', 'true');
    return this.http.post<{ data: { file: PtFile; job: PtJob } }>(`${this.api}/machines/${machineId}/transfer`, form, { headers: { 'Idempotency-Key': requestKey } });
  }
  backup(machineId: number, requestKey: string) {
    return this.http.post<{ data: { job: PtJob } }>(`${this.api}/machines/${machineId}/backup`, {}, { headers: { 'Idempotency-Key': requestKey } });
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
