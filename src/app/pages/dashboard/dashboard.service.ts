import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {

  private api = environment.apiUrl + '/dashboard';

  constructor(private http: HttpClient) {}

  getLive(page: number = 1, perPage: number = 8, status: string = 'all'): Observable<any> {
    return this.http.get<any>(
      this.api, { params: { paged: '1', page, per_page: perPage, status } }
    );
  }

  getMachineDetail(machineId: number): Observable<any> {
    return this.http.get(`${this.api}/live/${machineId}`);
  }

  /** The current shift as Running / Idle / Alarm / Off periods, with its breaks. */
  getTimeline(machineId: number): Observable<any> {
    return this.http.get(`${this.api}/live/${machineId}/timeline`);
  }

  /** Spindle load, speed and feed: the latest reading and a trend over the range. */
  getMachineSpindle(machineId: number, range: string): Observable<any> {
    return this.http.get(`${this.api}/live/${machineId}/spindle`, { params: { range } });
  }

}
