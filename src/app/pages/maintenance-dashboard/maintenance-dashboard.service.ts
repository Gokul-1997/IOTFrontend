import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 2 — Maintenance Dashboard.
   Shares charts/meta with Screen 1 for the machine and shift selects, so
   both screens offer exactly the same filter options. */
@Injectable({ providedIn: 'root' })
export class MaintenanceDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  getMeta(): Observable<any> {
    return this.master.get('charts');
  }

  getMaintenance(params: {
    date?: string;
    shift_id?: number | null;
    machine_id?: number | null;
  }): Observable<any> {
    const query: any = {};
    if (params.date)       query.date       = params.date;
    if (params.shift_id)   query.shift_id   = params.shift_id;
    if (params.machine_id) query.machine_id = params.machine_id;
    return this.http.get<any>(`${this.api}/dashboard/maintenance`, { params: query });
  }
}
