import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/** The company's one gateway, as its own people see it: online or not. S&T makes and holds its token. */
export interface PtGateway { token_prefix: string; token_created_at: string; last_seen_at: string | null; online: boolean }

/** A machine as Program Transfer shows it: its line of programs, the last one reported, its last backup. */
export interface PtMachine {
  id: number;
  machine_serial_no: string;
  /** where the gateway sends its programs, as set on the Machines page (absent from an older server) */
  program_path?: string | null;
  machine_ip?: string | null;
  controller_type?: string | null;
  /**
   * the program in front of the machine's line: the gateway's next to send (null: nothing waiting).
   * sent_to_gateway_at: the gateway downloaded it and has not reported yet; report_late: for 10 minutes or more
   * (both absent from an older server: the page then says "next to send", as before)
   */
  next: { id: number; program_name: string; size_bytes: number; created_at: string;
          sent_to_gateway_at?: string | null; report_late?: boolean } | null;
  /** uploads waiting for the machine, the one in front included */
  waiting: number;
  /** the last program the gateway reported on: on the machine (DONE) or refused (FAILED) */
  last_report: { id: number; program_name: string; delivery_status: 'DONE' | 'FAILED'; delivery_message: string | null; delivered_at: string | null } | null;
  last_backup: { id: number; program_name: string; created_at: string } | null;
  /** a Backup press the gateway has not answered yet (offered to it for 30 minutes) */
  backup_request: { id: number; requested_at: string } | null;
  /** the last backup asked for came to nothing — the gateway could not read it, or never answered (unanswered) */
  backup_failure: { message: string; at: string; unanswered?: boolean } | null;
}

/** What became of an upload: written to the machine, refused by it, or never sent (an upload from before the line, 22 Oct 2026). */
export type PtDelivery = 'DONE' | 'FAILED' | 'SKIPPED';

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
  /** an upload still in line: its place (1 = next to go); null for everything else */
  queue_position: number | null;
  delivery_status: PtDelivery | null;
  delivery_message: string | null;
  delivered_at: string | null;
  /** when the gateway last downloaded it (an upload still in line: it has it, no report yet) */
  sent_to_gateway_at?: string | null;
}

export interface PtPage { page: number; limit: number; total: number; totalPages: number }

/*
 * Program Transfer (21 Oct 2026; one gateway per company since 22 Oct):
 * upload programs — they wait in line per machine — download files, ask a
 * machine for a backup. The company's gateway does the rest with its own
 * four calls (/api/device/v1: status, program, backup, report) and the one
 * token S&T made for it; the report is how the page learns a machine took
 * or refused a program.
 */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient) {}

  /** The machines, and beside them the company's gateway (null: S&T has not made its token yet). */
  getMachines() {
    return this.http.get<{ data: PtMachine[]; gateway?: PtGateway | null }>(`${this.api}/machines`);
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
}
