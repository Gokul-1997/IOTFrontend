import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** The bill dates as Tariff & Rates and the forecast show them (GET/PUT /dashboard/energy/bill-period). */
export interface BillDates {
  configured: boolean;
  /** As typed in, from the EB bill. */
  entered: { start: string; end: string } | null;
  /** The bill today falls in, and the one after it (they follow on by themselves). */
  current: { start: string; end: string; days: number } | null;
  next: { start: string; end: string; days: number } | null;
  /** "Every month", "Every 2 months", "Every 30 days". */
  repeats: string | null;
}

/** One day of the bill, for the running-total chart. Money is null with no tariff. */
export interface BillDay {
  day: string;
  kind: 'past' | 'today' | 'coming';
  to_date_kwh: number | null; to_date_cost: number | null;
  forecast_kwh: number | null; forecast_cost: number | null;
  low_kwh: number | null; high_kwh: number | null;
  low_cost: number | null; high_cost: number | null;
}

/** GET /dashboard/energy/bill — this electricity bill, forecast. */
export interface BillForecast extends BillDates {
  currency: string;
  scope: { machine_id: number | null; machine: string | null };
  /** The bill's own days are still being worked out (first look after an update): no figures yet. */
  preparing?: boolean;
  period?: { start: string; end: string; days: number; day: number; days_left: number };
  so_far?: { kwh: number; cost: number | null } | null;
  rest?: { kwh: number; cost: number | null } | null;
  forecast?: { kwh: number; cost: number | null; low_kwh: number; high_kwh: number; low_cost: number | null; high_cost: number | null } | null;
  per_day?: BillDay[];
  machines?: { in_scope: number; metered: number; forecast: number; too_new: number; unpriced: number };
  history?: { from: string; weeks: number };
  accuracy?: { from: string; to: string; forecast_kwh: number; actual_kwh: number; error_pct: number } | null;
  previous?: { start: string; end: string; kwh: number; cost: number | null } | null;
}

/* Phase 2 · Screen 9 — Energy Monitoring. */
@Injectable({ providedIn: 'root' })
export class EnergyDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  getMeta(): Observable<any> {
    return this.master.get('charts');
  }

  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'search', 'show', 'page', 'limit', 'part']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getEnergy(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/energy`, { params: this.toQuery(filters) });
  }

  getSettings(): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/energy/settings`);
  }

  saveSettings(s: any): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/energy/settings`, s);
  }

  /** This electricity bill's forecast, for one machine or all of them. */
  getBill(machineId: number | null): Observable<{ status: string; data: BillForecast }> {
    const params: any = machineId ? { machine_id: machineId } : {};
    return this.http.get<{ status: string; data: BillForecast }>(`${this.api}/dashboard/energy/bill`, { params });
  }

  getBillDates(): Observable<{ status: string; data: BillDates }> {
    return this.http.get<{ status: string; data: BillDates }>(`${this.api}/dashboard/energy/bill-period`);
  }

  saveBillDates(start: string, end: string): Observable<{ status: string; data: BillDates }> {
    return this.http.put<{ status: string; data: BillDates }>(`${this.api}/dashboard/energy/bill-period`,
      { period_start: start, period_end: end });
  }

  clearBillDates(): Observable<{ status: string; data: BillDates }> {
    return this.http.delete<{ status: string; data: BillDates }>(`${this.api}/dashboard/energy/bill-period`);
  }

  exportAs(format: 'xlsx' | 'csv', filters: any): Observable<Blob> {
    const { page, limit, part, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/energy/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
