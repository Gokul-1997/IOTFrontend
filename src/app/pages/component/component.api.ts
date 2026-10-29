import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ComponentApi {
    private api = environment.apiUrl;

    constructor(private http: HttpClient) { }

    /** `table`: the table's header sort and filters (shared/table: sort, dir, f_…, q_…). */
    list(page: number, limit: number, search: string, table: Record<string, string> = {}) {
        return this.http.get<any>(`${this.api}/components`, { params: { ...table, page: String(page), limit: String(limit), search } });
    }
    create(data: any) {
        return this.http.post<any>(`${this.api}/components`, data);
    }

    update(id: number, data: any) {
        return this.http.put<any>(`${this.api}/components/${id}`, data);
    }

    delete(id: number) {
        return this.http.delete<any>(`${this.api}/components/${id}`);
    }
    getMachines() {
        return this.http.get<any>(`${this.api}/master/machines`);
    }
}