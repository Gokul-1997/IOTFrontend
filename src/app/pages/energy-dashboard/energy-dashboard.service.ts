import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** An EB bill, every figure as printed. From → To are the reading dates: To starts the next bill. */
export interface EbBill {
  id: number; connection_id: number;
  from: string; to: string; days: number;
  units: number; rate: number | null;
  electricity_charges: number; peak_charges: number; fixed_charges: number; penalty_charges: number;
  welding_charges: number; tax_charges: number; other_charges: number; net_amount: number;
}

/** The EB meter's kWh register on a day. */
export interface EbReading { id: number; read_on: string; kwh: number; }

/** A service connection on Tariff & Rates: its bills (newest first), recent readings, and the bill it is on now. */
export interface EbConnection {
  id: number; sc_number: string; name: string | null;
  meter: { machine_id: number; machine: string | null } | null;
  bills: EbBill[];
  readings: EbReading[];
  current: { start: string; end: string; days: number } | null;
  cycle: string | null;
}

/** A forecast bill, line by line as the EB prints it (whole rupees). */
export interface EbLines {
  units: number; electricity_charges: number; peak_charges: number; fixed_charges: number;
  penalty_charges: number; welding_charges: number; tax_charges: number; net_amount: number;
}

/** One supply's bill now: where its units come from, and its forecast. */
export interface EbForecast {
  id: number; sc_number: string; name: string | null;
  meter: { machine_id: number; machine: string | null } | null;
  status: 'ok' | 'no_bill';
  period?: { start: string; end: string; days: number; day: number; days_left: number };
  cycle?: string;
  /** readings: EB meter readings · meter: a meter on the supply · bills: the last bills' units per day (an estimate). */
  source?: 'readings' | 'meter' | 'bills';
  units?: { so_far: number; as_of: string | null; rest: number; total: number; per_day: number | null; measured: boolean; bills: number | null };
  forecast?: EbLines;
  range?: { low: number; high: number } | null;
  tariff?: { rate: number; printed_rate: number | null; fixed_charges: number; peak_pct: number; penalty_pct: number; welding_pct: number; tax_pct: number };
  last_bill?: EbBill;
  change_pct?: number | null;
}

/** GET /dashboard/energy/bill — this bill for every supply, and their total. */
export interface BillForecast {
  configured: boolean;
  /** Someone who sees one plant: the bill is the whole company's. */
  restricted: boolean;
  currency: string;
  connections: EbForecast[];
  total: { units: number; net_amount: number; low: number | null; high: number | null; last_net: number; ends: string; measured: boolean } | null;
  updated_at?: string;
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

  /** This electricity bill, for every service connection. */
  getBill(): Observable<{ status: string; data: BillForecast }> {
    return this.http.get<{ status: string; data: BillForecast }>(`${this.api}/dashboard/energy/bill`);
  }

  getConnections(): Observable<{ status: string; data: EbConnection[] }> {
    return this.http.get<{ status: string; data: EbConnection[] }>(`${this.api}/dashboard/energy/connections`);
  }

  saveConnection(body: { sc_number: string; name: string | null; meter_machine_id: number | null }, id?: number): Observable<any> {
    const url = `${this.api}/dashboard/energy/connections`;
    return id ? this.http.put(`${url}/${id}`, body) : this.http.post(url, body);
  }

  deleteConnection(id: number): Observable<any> {
    return this.http.delete(`${this.api}/dashboard/energy/connections/${id}`);
  }

  saveEbBill(connectionId: number, body: any, billId?: number): Observable<any> {
    const url = `${this.api}/dashboard/energy/connections/${connectionId}/bills`;
    return billId ? this.http.put(`${url}/${billId}`, body) : this.http.post(url, body);
  }

  deleteEbBill(connectionId: number, billId: number): Observable<any> {
    return this.http.delete(`${this.api}/dashboard/energy/connections/${connectionId}/bills/${billId}`);
  }

  saveReading(connectionId: number, body: { read_on: string; kwh: number }): Observable<any> {
    return this.http.post(`${this.api}/dashboard/energy/connections/${connectionId}/readings`, body);
  }

  deleteReading(connectionId: number, readingId: number): Observable<any> {
    return this.http.delete(`${this.api}/dashboard/energy/connections/${connectionId}/readings/${readingId}`);
  }

  exportAs(format: 'xlsx' | 'csv', filters: any): Observable<Blob> {
    const { page, limit, part, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/energy/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
