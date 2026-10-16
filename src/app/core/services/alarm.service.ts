import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface CriticalAlarmPolicy {
  enabled: boolean;
  version: number;
  counts: { machines: number };
}

@Injectable({ providedIn: 'root' })
export class AlarmService {
  private api = environment.apiUrl + '/alarms';
  constructor(private http: HttpClient) {}

  getAlarms(params: any = {}) { return this.http.get<any>(this.api, { params }); }
  resolveAlarm(id: number, note: string) { return this.http.patch(`${this.api}/${id}/resolve`, { resolution_note: note }); }
  getPreferences() { return this.http.get<any>(`${this.api}/preferences`); }
  updatePreferences(prefs: any) { return this.http.put<any>(`${this.api}/preferences`, prefs); }

  getNotificationPolicy() {
    return this.http.get<{ success: boolean; data: CriticalAlarmPolicy }>(`${this.api}/notification-policy`);
  }

  updateNotificationPolicy(enabled: boolean, expectedVersion: number) {
    return this.http.put<{ success: boolean; data: CriticalAlarmPolicy }>(`${this.api}/notification-policy`,
      { enabled, expected_version: expectedVersion });
  }
}
