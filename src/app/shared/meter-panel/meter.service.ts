import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Everything a machine's energy meter reports (energy_meter_readings). */
@Injectable({ providedIn: 'root' })
export class MeterService {
  private api = environment.apiUrl + '/dashboard';

  constructor(private http: HttpClient) {}

  /** Energy screen: any machine of the company with a meter — the first one when none is named. */
  forEnergy(machineId: number | null, range: string): Observable<any> {
    const params: Record<string, string> = { range };
    if (machineId) params['machine_id'] = String(machineId);
    return this.http.get<any>(`${this.api}/energy/meter`, { params });
  }
}
