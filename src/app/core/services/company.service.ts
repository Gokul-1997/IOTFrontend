import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/** How much a company may use Mexa AI — S&T's alone (23 Oct 2026). 0 in any switches it off for the company. */
export interface AssistantFigures { person_daily: number; company_daily: number; monthly_usd: number }
export interface CompanyAssistantLimits extends AssistantFigures {
  company_id: number; company_name: string; timezone: string;
  /** S&T ticked the AI in the company's access. */
  granted: boolean;
  defaults: AssistantFigures;
  /** The server's ceilings: no figure passes them. */
  max: AssistantFigures;
  usage: { today: { questions: number; answers: number; people: number }; month: { questions: number; answers: number; spent_usd: number } };
  updated_at: string | null;
}

/** A company's Program Transfer gateway as S&T sees it (the token itself is only ever in the answer that makes it). */
export interface ProgramGatewayInfo {
  token_prefix: string; token_created_at: string; last_seen_at: string | null; online: boolean;
  last_seen_ip: string | null; agent_version: string | null;
}
export interface ProgramGatewayState { company_id: number; company_name: string; gateway: ProgramGatewayInfo | null; poll_seconds: number }

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ── Companies ──────────────────────────────────
  getCompanies(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies`);
  }

  getCompany(id: number): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${id}`);
  }

  createCompany(data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies`, data);
  }

  updateCompany(id: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${id}`, data);
  }

  deleteCompany(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/companies/${id}`);
  }

  permanentDeleteCompany(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/companies/${id}/permanent`);
  }

  assignPlan(companyId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies/${companyId}/plan`, data);
  }

  /** Plan changes over time: who changed it, when, from what, and why. */
  getPlanHistory(companyId: number, params?: any): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${companyId}/plan/history`, { params: params || {} });
  }

  /** Current usage against the plan's limits, resolved as the quota check resolves them. */
  getCompanyUsage(companyId: number): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${companyId}/usage`);
  }

  getPlanFeatures(companyId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies/${companyId}/plan-features`);
  }

  // ── Plans ──────────────────────────────────────
  getPlans(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/plans`);
  }

  getPlan(id: number): Observable<any> {
    return this.http.get<any>(`${this.api}/plans/${id}`);
  }

  createPlan(data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/plans`, data);
  }

  updatePlan(id: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/plans/${id}`, data);
  }

  // ── Company Plants (SNT_SUPER manages plants per company) ──
  getCompanyPlants(companyId: number, params?: any): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${companyId}/plants`, { params });
  }

  createCompanyPlant(companyId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies/${companyId}/plants`, data);
  }

  updateCompanyPlant(companyId: number, plantId: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${companyId}/plants/${plantId}`, data);
  }

  toggleCompanyPlantStatus(companyId: number, plantId: number, is_active: boolean): Observable<any> {
    return this.http.patch<any>(`${this.api}/companies/${companyId}/plants/${plantId}/status`, { is_active });
  }

  // ── Permissions ────────────────────────────────
  getGroupedPermissions(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/plans/permissions`);
  }

  seedPermissions(): Observable<any> {
    return this.http.post<any>(`${this.api}/plans/permissions/seed`, {});
  }

  // ── Company Permissions (page access per company) ─
  getCompanyPermissions(companyId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies/${companyId}/permissions`);
  }

  assignCompanyPermissions(companyId: number, permissionIds: number[]): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${companyId}/permissions`, { permission_ids: permissionIds });
  }

  // ── Program Transfer gateway: one token per company, for all its machines (SNT_SUPER) ─
  getProgramGateway(companyId: number): Observable<ProgramGatewayState> {
    return this.http.get<ProgramGatewayState>(`${this.api}/companies/${companyId}/program-gateway`);
  }

  /** A new token (the old one stops at once). Shown in this answer only. */
  createProgramGatewayToken(companyId: number): Observable<{ token: string; token_prefix: string; created_at: string; company_name: string }> {
    return this.http.post<{ token: string; token_prefix: string; created_at: string; company_name: string }>(
      `${this.api}/companies/${companyId}/program-gateway/token`, {});
  }

  revokeProgramGatewayToken(companyId: number): Observable<{ revoked: boolean }> {
    return this.http.delete<{ revoked: boolean }>(`${this.api}/companies/${companyId}/program-gateway/token`);
  }

  // ── Mexa AI: how much the company may use it, and its use (SNT_SUPER) ─
  getAssistantLimits(companyId: number): Observable<CompanyAssistantLimits> {
    return this.http.get<{ data: CompanyAssistantLimits }>(`${this.api}/companies/${companyId}/assistant`).pipe(map(r => r.data));
  }

  /** S&T raises or lowers the company's figures, and sets its timezone (its midnight brings the day back). */
  saveAssistantLimits(companyId: number, body: AssistantFigures & { timezone: string }): Observable<CompanyAssistantLimits> {
    return this.http.put<{ data: CompanyAssistantLimits }>(`${this.api}/companies/${companyId}/assistant`, body).pipe(map(r => r.data));
  }
}
