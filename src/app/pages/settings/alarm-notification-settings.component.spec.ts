import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { AlarmNotificationSettingsComponent } from './alarm-notification-settings.component';

const rule = { machine_id: 15, machine_serial_no: 'CNC-15', plant_name: 'Plant A', enabled: false, delay_seconds: 600 };
const result = { success: true, data: [rule], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };

describe('alarm notification settings', () => {
  let component: AlarmNotificationSettingsComponent;
  let alarms: any;
  let notifications: any;

  function create(admin = true) {
    component = new AlarmNotificationSettingsComponent(alarms, notifications,
      { isCompanyAdmin: () => admin, isSntSuper: () => false } as any, { markForCheck() {} } as any);
    component.ngOnInit();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    alarms = { getNotificationRules: vi.fn(() => of(result)), updateNotificationRule: vi.fn((id, value) => of({ success: true, data: { ...rule, machine_id: id, ...value } })) };
    notifications = { getAlarmPreference: vi.fn(() => of({ success: true, data: { notify_alarm: false } })),
      updateAlarmPreference: vi.fn(value => of({ success: true, data: { notify_alarm: value } })) };
  });
  afterEach(() => { component?.ngOnDestroy(); vi.useRealTimers(); });

  it('loads one bounded page, with no periodic fleet requests', () => {
    create();
    expect(alarms.getNotificationRules).toHaveBeenCalledWith(1, '');
    vi.advanceTimersByTime(600_000);
    expect(alarms.getNotificationRules).toHaveBeenCalledTimes(1);
    expect(component.rows[0].preset).toBe(600);
  });

  it('loads a regular person’s preference without any company rule request', () => {
    create(false);
    expect(component.receive).toBe(false);
    expect(notifications.getAlarmPreference).toHaveBeenCalledTimes(1);
    expect(alarms.getNotificationRules).not.toHaveBeenCalled();
    component.loadPage(2);
    expect(alarms.getNotificationRules).not.toHaveBeenCalled();
  });

  it('restores a saved opt-out on failure, then lets the person reload and opt in', () => {
    create(false);
    notifications.updateAlarmPreference.mockReturnValueOnce(throwError(() => ({ error: { message: 'Temporarily unavailable' } })));
    component.toggleReceive();
    expect(component.receive).toBe(false);
    expect(component.preferenceError).toBe('Temporarily unavailable');
    component.loadPreference();
    component.toggleReceive();
    expect(notifications.updateAlarmPreference).toHaveBeenLastCalledWith(true);
    expect(component.receive).toBe(true);
    expect(component.preferenceStatus).toBe('Saved');
  });

  it('saves the chosen second-based delay and machine enable state, without automatic writes', () => {
    create();
    const row = component.rows[0];
    row.enabled = true;
    row.preset = 30;
    component.edited(row);
    expect(alarms.updateNotificationRule).not.toHaveBeenCalled();
    component.save(row);
    expect(alarms.updateNotificationRule).toHaveBeenCalledWith(15, { enabled: true, delay_seconds: 30 });
    expect(component.changed(row)).toBe(false);
    expect(row.status).toBe('Saved');
  });

  it.each([null, 0, 0.5, 86401])('rejects invalid custom delay %s without a request', seconds => {
    create();
    const row = component.rows[0];
    row.preset = 'custom';
    row.customSeconds = seconds;
    component.save(row);
    expect(row.error).toBe('Enter whole seconds from 1 to 86,400.');
    expect(alarms.updateNotificationRule).not.toHaveBeenCalled();
  });

  it('keeps a failed rule change ready to retry', () => {
    create();
    const row = component.rows[0];
    row.enabled = true;
    alarms.updateNotificationRule.mockReturnValueOnce(throwError(() => ({ error: { message: 'Machine no longer active' } })));
    component.save(row);
    expect(row.enabled).toBe(true);
    expect(component.changed(row)).toBe(true);
    expect(row.saving).toBe(false);
    expect(row.error).toBe('Machine no longer active');
    component.save(row);
    expect(row.status).toBe('Saved');
  });

  it('cancels an outdated page and debounces rapid searches into one request', () => {
    const cancelled = vi.fn();
    alarms.getNotificationRules.mockReturnValueOnce(new Observable(() => cancelled));
    create();
    component.searchChanged('C');
    expect(cancelled).toHaveBeenCalledTimes(1);
    component.searchChanged('CN');
    component.searchChanged('CNC-15');
    vi.advanceTimersByTime(299);
    expect(alarms.getNotificationRules).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(alarms.getNotificationRules).toHaveBeenCalledTimes(2);
    expect(alarms.getNotificationRules).toHaveBeenLastCalledWith(1, 'CNC-15');
  });

  it('bounds search length and cancels pending work when leaving Settings', () => {
    create();
    component.searchChanged('x'.repeat(500));
    expect(component.search).toHaveLength(100);
    component.ngOnDestroy();
    vi.advanceTimersByTime(1000);
    expect(alarms.getNotificationRules).toHaveBeenCalledTimes(1);
  });
});
