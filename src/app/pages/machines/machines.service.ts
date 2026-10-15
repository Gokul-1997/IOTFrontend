import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MachinesService {
  private api = `${environment.apiUrl}/machines`;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  getMachines(params: any) {
    return this.http.get<any>(this.api, { params });
  }

  getAllForDropdown() {
    return this.master.get('machines');
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

  delete(id: number) {
    return this.http.delete(`${this.api}/${id}`);
  }

  getPlants() {
    return this.master.get('plants');
  }
  uploadImage(file: File, plantId: number) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('plant_id', String(plantId));

    return this.http.post<{ fileUrl: string }>(`${environment.apiUrl}/upload`, formData);
  }

  getLines() {
  return this.master.get('lines');
}
}
