import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { AlarmNotificationSettingsComponent } from './alarm-notification-settings.component';

const policy = () => ({ enabled: false, version: 3, counts: { machines: 150 } });
describe('critical-only alarm settings', () => {
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
    alarms = { getNotificationPolicy: vi.fn(() => of({ success: true, data: policy() })),
      updateNotificationPolicy: vi.fn(enabled => of({ success: true, data: { ...policy(), enabled, version: 4 } })) };
    notifications = { getAlarmPreference: vi.fn(() => of({ success: true, data: { notify_alarm: false } })),
      updateAlarmPreference: vi.fn(value => of({ success: true, data: { notify_alarm: value } })) };
  });
  afterEach(() => { component?.ngOnDestroy(); vi.useRealTimers(); });

  it('loads one company policy without polling telemetry or machine pages', () => {
    create();
    expect(component.companyEnabled).toBe(false);
    expect(component.policy?.counts.machines).toBe(150);
    expect(component.companyChanged).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(alarms.getNotificationPolicy).toHaveBeenCalledTimes(1);
    expect(alarms.updateNotificationPolicy).not.toHaveBeenCalled();
  });
  it('loads only the personal preference for a regular user', () => {
    create(false);
    expect(component.receive).toBe(false);
    expect(alarms.getNotificationPolicy).not.toHaveBeenCalled();
    component.loadCompany(); component.saveCompany();
    expect(alarms.updateNotificationPolicy).not.toHaveBeenCalled();
  });
  it('requires an explicit save before applying company-wide critical alerts', () => {
    create();
    expect(component.showInboxHint).toBe(false);
    component.toggleCompany();
    expect(component.showInboxHint).toBe(true);
    component.toggleReceive();
    expect(component.showInboxHint).toBe(false);
    expect(component.companyChanged).toBe(true);
    expect(alarms.updateNotificationPolicy).not.toHaveBeenCalled();
    component.saveCompany();
    expect(alarms.updateNotificationPolicy).toHaveBeenCalledWith(true, 3);
    expect(component.companyChanged).toBe(false);
    expect(component.companyStatus).toContain('all company machines');
  });
  it('can switch company alerts off without changing a personal preference', () => {
    alarms.getNotificationPolicy.mockReturnValueOnce(of({ success: true, data: { ...policy(), enabled: true } }));
    create(); component.toggleCompany(); component.saveCompany();
    expect(alarms.updateNotificationPolicy).toHaveBeenCalledWith(false, 3);
    expect(component.companyStatus).toContain('turned off');
    expect(notifications.updateAlarmPreference).not.toHaveBeenCalled();
  });
  it('retains a company draft on failure and supports retry', () => {
    create(); component.toggleCompany();
    alarms.updateNotificationPolicy.mockReturnValueOnce(throwError(() => ({ status: 503, error: { message: 'Try again' } })));
    component.saveCompany();
    expect(component.companyEnabled).toBe(true);
    expect(component.companyError).toBe('Try again');
    expect(component.companySaving).toBe(false);
    component.saveCompany(); expect(component.companyChanged).toBe(false);
  });
  it('blocks stale writes after an admin conflict until the latest policy is reloaded', () => {
    create(); component.toggleCompany();
    alarms.updateNotificationPolicy.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    component.saveCompany(); component.saveCompany(); component.toggleCompany();
    expect(alarms.updateNotificationPolicy).toHaveBeenCalledTimes(1);
    expect(component.companyConflict).toBe(true);
    expect(component.companyEnabled).toBe(true);
    expect(component.companyError).toContain('Another admin');
    component.loadCompany();
    expect(component.companyConflict).toBe(false);
    expect(component.companyEnabled).toBe(false);
  });
  it('does not allow company changes before loading succeeds', () => {
    alarms.getNotificationPolicy.mockReturnValueOnce(throwError(() => ({ error: { message: 'Cannot load' } })));
    create(); component.toggleCompany(); component.saveCompany();
    expect(component.companyError).toBe('Cannot load');
    expect(alarms.updateNotificationPolicy).not.toHaveBeenCalled();
    component.loadCompany(); expect(component.policy?.version).toBe(3);
  });
  it('ignores duplicate saves while a company update is in flight', () => {
    create(); component.toggleCompany(); alarms.updateNotificationPolicy.mockReturnValueOnce(new Observable(() => {}));
    component.saveCompany(); component.saveCompany(); component.toggleCompany();
    expect(alarms.updateNotificationPolicy).toHaveBeenCalledTimes(1);
    expect(component.companyEnabled).toBe(true);
  });
  it('restores a saved personal opt-out on failure and supports retry', () => {
    create(false);
    notifications.updateAlarmPreference.mockReturnValueOnce(throwError(() => ({ error: { message: 'Unavailable' } })));
    component.toggleReceive();
    expect(component.receive).toBe(false);
    expect(component.preferenceError).toBe('Unavailable');
    component.loadPreference(); component.toggleReceive();
    expect(notifications.updateAlarmPreference).toHaveBeenLastCalledWith(true);
    expect(component.receive).toBe(true);
    expect(alarms.updateNotificationPolicy).not.toHaveBeenCalled();
  });
  it('does not overwrite a personal preference before it has loaded', () => {
    notifications.getAlarmPreference.mockReturnValueOnce(throwError(() => ({ error: { message: 'Try again' } })));
    create(); component.toggleReceive();
    expect(notifications.updateAlarmPreference).not.toHaveBeenCalled();
    component.loadPreference(); component.toggleReceive();
    expect(component.preferenceStatus).toBe('Saved');
  });
  it('cancels pending preference and company requests on leaving Settings', () => {
    const cancelPreference = vi.fn(); const cancelCompany = vi.fn();
    notifications.getAlarmPreference.mockReturnValueOnce(new Observable(() => cancelPreference));
    alarms.getNotificationPolicy.mockReturnValueOnce(new Observable(() => cancelCompany));
    create(); component.ngOnDestroy();
    expect(cancelPreference).toHaveBeenCalledTimes(1);
    expect(cancelCompany).toHaveBeenCalledTimes(1);
  });
});
