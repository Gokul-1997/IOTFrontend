import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface AlarmNotificationRule {
  machine_id: number;
  machine_serial_no: string;
  plant_name: string | null;
  enabled: boolean;
  delay_seconds: number;
}

export interface AlarmNotificationRulePage {
  success: boolean;
  data: AlarmNotificationRule[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class AlarmService {
  private api = environment.apiUrl + '/alarms';
  constructor(private http: HttpClient) {}

  getAlarms(params: any = {}) { return this.http.get<any>(this.api, { params }); }
  resolveAlarm(id: number, note: string) { return this.http.patch(`${this.api}/${id}/resolve`, { resolution_note: note }); }
  getPreferences() { return this.http.get<any>(`${this.api}/preferences`); }
  updatePreferences(prefs: any) { return this.http.put<any>(`${this.api}/preferences`, prefs); }

  getNotificationRules(page = 1, search = '') {
    return this.http.get<AlarmNotificationRulePage>(`${this.api}/notification-rules`, {
      params: { page, limit: 20, search }
    });
  }

  updateNotificationRule(machineId: number, rule: Pick<AlarmNotificationRule, 'enabled' | 'delay_seconds'>) {
    return this.http.put<{ success: boolean; data: AlarmNotificationRule }>(`${this.api}/notification-rules/${machineId}`, rule);
  }
}
