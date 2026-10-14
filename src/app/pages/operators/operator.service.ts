import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OperatorService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  // ------------------------
  // OPERATORS
  // ------------------------
  getAll(params: any = {}) {
    return this.http.get<any>(`${this.api}/operators`, { params });
  }

  create(data: any) {
    return this.http.post(`${this.api}/operators`, data);
  }

  // ------------------------
  // SHIFTS (for dropdown)
  // ------------------------
  getShifts() {
    return this.master.get('shifts');
  }

  // ------------------------
  // MACHINES (for assignment)
  // ------------------------
  getMachines() {
    return this.master.get('machines');
  }

  // operator.service.ts

update(id: number, data: any) {
  return this.http.put(`${this.api}/operators/${id}`, data);
}

getById(id: number) {
  return this.http.get<any>(`${this.api}/operators/${id}`);
}

delete(id: number) {
  return this.http.delete(`${this.api}/operators/${id}`);
}
}

