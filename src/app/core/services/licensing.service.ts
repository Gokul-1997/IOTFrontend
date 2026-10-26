import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export interface DeploymentLicense {
  id: string; company_id: number; company_name?: string; name: string;
  deployment_mode: 'cloud' | 'on_prem'; installation_id: string;
  max_machines: number; expires_at: string; status: 'active' | 'suspended' | 'revoked';
  revision: number; last_seen_at?: string; last_reported_machines?: number;
  note?: string; payment_reference?: string;
}
export interface LicenseForm {
  company_id: number; name: string; deployment_mode: 'cloud' | 'on_prem';
  max_machines: number; expires_at: string; note: string; payment_reference: string;
}
export function licenseFormError(form: LicenseForm): string | null {
  if (!Number.isSafeInteger(Number(form.company_id)) || Number(form.company_id) < 1) return 'Select a company.';
  if (!form.name.trim() || form.name.trim().length > 120) return 'Enter a name of up to 120 characters.';
  if (!Number.isSafeInteger(Number(form.max_machines)) || Number(form.max_machines) < 1 || Number(form.max_machines) > 100000) return 'Machine allowance must be a whole number from 1 to 100,000.';
  if (!Number.isFinite(Date.parse(form.expires_at)) || Date.parse(form.expires_at) <= Date.now()) return 'Choose a future expiry date.';
  if (form.note.length > 1000 || form.payment_reference.length > 200) return 'The note or payment reference is too long.';
  return null;
}
@Injectable({ providedIn: 'root' })
export class LicensingService {
  private readonly url = `${environment.apiUrl}/licensing`;
  constructor(private http: HttpClient, private auth: AuthService) {}
  available(): Observable<boolean> {
    if (!environment.phase3Licensing || !this.auth.isSntSuper()) return of(false);
    return this.http.get<{ enabled: boolean; authority: boolean }>(`${this.url}/capabilities`).pipe(
      map(value => this.auth.isSntSuper() && value.enabled === true && value.authority === true), catchError(() => of(false)));
  }
  list() { return this.http.get<DeploymentLicense[]>(this.url); }
  create(body: LicenseForm) { return this.http.post<{ license: DeploymentLicense; activation_token: string; installation_id: string }>(this.url, body); }
  update(id: string, body: Partial<LicenseForm> & { status?: DeploymentLicense['status'] }) { return this.http.put<DeploymentLicense>(`${this.url}/${id}`, body); }
  rotate(id: string) { return this.http.post<{ activation_token: string; installation_id: string }>(`${this.url}/${id}/rotate-token`, {}); }
  history(id: string) { return this.http.get<{ id: number; actor_id: number; action: string; created_at: string; note?: string; payment_reference?: string }[]>(`${this.url}/${id}/history`); }
}
