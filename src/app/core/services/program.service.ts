import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/** A machine as Program Transfer shows it: its gateway, its program, its last backup. */
export interface PtMachine {
  id: number;
  machine_serial_no: string;
  /** null: no gateway token yet */
  gateway: { token_prefix: string; token_created_at: string; last_seen_at: string | null; online: boolean } | null;
  /** the machine's program: its newest upload */
  program: { id: number; program_name: string; size_bytes: number; created_at: string } | null;
  last_backup: { id: number; program_name: string; created_at: string } | null;
  /** a Backup press the gateway has not answered yet */
  backup_request: { id: number; requested_at: string } | null;
}

export type PtKind = 'NEW' | 'BACKUP' | 'FETCHED';
export type PtFilter = '' | 'uploads' | 'backups';

export interface PtFile {
  id: number;
  machine_id: number;
  program_name: string;
  kind: PtKind;
  size_bytes: number;
  sha256: string;
  created_at: string;
  uploaded_by_name: string | null;
  is_current: boolean;
}

export interface PtPage { page: number; limit: number; total: number; totalPages: number }

/*
 * Program Transfer, kept simple (21 Oct 2026): upload a machine's program,
 * download files, ask the machine for a backup. The machine's gateway does
 * the rest with its own three calls (/api/device/v1: status, program, backup).
 */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient) {}

  getMachines() {
    return this.http.get<{ data: PtMachine[] }>(`${this.api}/machines`);
  }

  getFiles(machineId: number, kind: PtFilter, page: number, limit: number) {
    const params: Record<string, string> = { machine_id: String(machineId), page: String(page), limit: String(limit) };
    if (kind) params['kind'] = kind;
    return this.http.get<{ data: PtFile[]; pagination: PtPage }>(`${this.api}/files`, { params });
  }

  /** With progress events, for the upload dialog's bar. */
  upload(machineId: number, file: File) {
    const form = new FormData();
    form.append('machine_id', String(machineId));
    form.append('file', file);
    return this.http.post<{ data: PtFile }>(`${this.api}/files`, form, { reportProgress: true, observe: 'events' });
  }

  download(fileId: number) {
    return this.http.get(`${this.api}/files/${fileId}/download`, { responseType: 'blob' });
  }

  remove(fileId: number) {
    return this.http.delete(`${this.api}/files/${fileId}`);
  }

  requestBackup(machineId: number) {
    return this.http.post<{ data: { id: number; requested_at: string; created: boolean } }>(`${this.api}/machines/${machineId}/backup`, {});
  }

  createToken(machineId: number) {
    return this.http.post<{ data: { token: string; token_prefix: string; created_at: string } }>(`${this.api}/machines/${machineId}/device-token`, {});
  }

  revokeToken(machineId: number) {
    return this.http.delete(`${this.api}/machines/${machineId}/device-token`);
  }
}
