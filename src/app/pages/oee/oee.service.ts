import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OeeService {
  private api = environment.apiUrl + '/dashboard';

  constructor(private http: HttpClient) {}

  getHourly(machineId: number, date: string) {
    return this.http.get<any[]>(
      `${this.api}/hourly-oee?machine_id=${machineId}&date=${date}`
    );
  }
}
