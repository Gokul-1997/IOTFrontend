import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class QualityService {

    private api = environment.apiUrl;

    constructor(private http: HttpClient, private master: MasterDataService) { }

    /** Every active machine of the company, by name. */
    getAllMachines() {
        return this.master.get('machines');
    }

    getShifts() {
        return this.master.get('masterShifts');
    }

    getDashboard(params: any) {
        return this.http.get<any>(`${this.api}/quality`, {
            params
        });
    }
    saveQuality(payload: { machine_id: number; shift_id: number; date: string; reject_qty: number; rework_qty: number }) {
        return this.http.post<any>(`${this.api}/quality/entry`, payload);
    }
}