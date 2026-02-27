import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class QualityService {

    private api = environment.apiUrl;

    constructor(private http: HttpClient) { }

    getLines() {
        return this.http.get<any>(`${this.api}/lines`);
    }

    getMachines(line_id: number) {
        return this.http.get<any>(`${this.api}/master/machines`, {
            params: { line_id }
        });
    }

    getShifts() {
        return this.http.get<any>(`${this.api}/master/shifts`);
    }

    getDashboard(params: any) {
        return this.http.get<any>(`${this.api}/quality`, {
            params
        });
    }
    getMachinesByLine(line_id: number) {
        return this.http.get<any>(`${this.api}/master/machines-by-line`, {
            params: { line_id }
        });
    }
}