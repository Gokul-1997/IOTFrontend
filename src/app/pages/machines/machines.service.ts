import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MachinesService {
  private api = `${environment.apiUrl}/machines`;
  private plantsApi = `${environment.apiUrl}/plants`;

  constructor(private http: HttpClient) {}

  getMachines(params: any) {
    return this.http.get<any>(this.api, { params });
  }

  create(data: any) {
    return this.http.post(this.api, data);
  }

  update(id: number, data: any) {
    return this.http.put(`${this.api}/${id}`, data);
  }

  toggle(id: number, is_active: boolean) {
    return this.http.patch(`${this.api}/${id}/status`, { is_active });
  }

  getPlants() {
    return this.http.get<any>(this.plantsApi);
  }
}
