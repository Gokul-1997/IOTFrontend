import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OeeReportsService {

  private baseUrl = `${environment.apiUrl}/oee`;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  /**
   * GET /oee/meta
   * Get metadata: machines, shifts, lines
   */
  getMeta(): Observable<any> {
    return this.master.get('oee');
  }

  /**
   * GET /oee/reports
   * Get OEE reports with filters and pagination
   */
  getReports(filters: any): Observable<any> {
    return this.http.get(`${this.baseUrl}/reports`, { params: this.params(filters) });
  }

  /**
   * GET /oee/export?format=csv|xlsx — every record for the filters. A small
   * export is the file (200); a large one is emailed (202 and a message):
   * see shared/report-file.ts.
   */
  export(format: 'csv' | 'xlsx', filters: any): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.baseUrl}/export`, {
      params: this.params({ ...filters, format }), observe: 'response', responseType: 'blob'
    });
  }

  private params(filters: any): HttpParams {
    let params = new HttpParams();
    Object.keys(filters).forEach(key => {
      if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
        params = params.set(key, filters[key]);
      }
    });
    return params;
  }

}
