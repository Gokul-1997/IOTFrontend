import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private api = environment.apiUrl + '/dashboard';
  constructor(private http: HttpClient) {}

  getLive() {
    return this.http.get<any[]>(`${this.api}/live`);
  }
}
