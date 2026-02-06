import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OeeReportsService {

  private baseUrl = `${environment.apiUrl}/oee`;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get(`${this.baseUrl}/meta`);
  }

  getReports(filters: any): Observable<any> {
    let params = new HttpParams();

    Object.keys(filters).forEach(key => {
      if (filters[key] !== null && filters[key] !== undefined) {
        params = params.set(key, filters[key]);
      }
    });

    return this.http.get(`${this.baseUrl}/reports`, { params });
  }
}
