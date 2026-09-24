import { ChangeDetectorRef, NgZone } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { LiveComponent, durationSeconds, reading } from './live.component';
import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';
import { AuthService } from '../../../core/services/auth.service';
import { ChartsService } from '../../charts/charts.service';

function component() {
  return new LiveComponent({} as ActivatedRoute, {} as DashboardService, {} as SocketService,
    { run: (callback: () => void) => callback() } as NgZone, { markForCheck() {} } as ChangeDetectorRef,
    { getCompanyPermissions: () => [], isAdmin: () => false, hasPermission: () => false } as unknown as AuthService,
    { getChartData: () => of({ data: { hourlyCount: [] } }) } as unknown as ChartsService);
}
const snapshot = {
  machine: { machine_serial_no: 'VMC-01' },
  job: { target_qty: 100, achieved_qty: 59 },
  live: { machine_status: 'RUNNING', parts_count: 59, spindle_load: 42, feed_rate: 1200, mode: 'AUTO' }
};
function apply(view: LiveComponent, data: unknown) { (view as any).applyApiData({ data }); }

describe('Machine dashboard measurements', () => {
  it('keeps unavailable sensors separate from valid zero readings', () => {
    for (const value of [null, undefined, '', ' ', false, NaN, Infinity, [], {}, -2]) expect(reading(value)).toBeNull();
    expect(reading(0)).toBe(0);
    expect(reading('12.5')).toBe(12.5);
    const view = component();
    apply(view, { machine: { name: 'Machine' } });
    expect(view.livePartCount).toBeNull();
    expect(view.liveSpindleLoad).toBeNull();
    expect(view.attainment).toBeNull();
    expect(view.formatDuration(view.runTime)).toBe('—');
  });
  it('formats setup seconds correctly, including zero and durations longer than a day', () => {
    const view = component();
    view.production = { manual_seconds: 3661 };
    expect(view.setupTime).toBe('01h 01m 01s');
    view.production.manual_seconds = 0;
    expect(view.setupTime).toBe('00h 00m 00s');
    expect(view.formatDuration('25:12:01')).toBe('25h 12m 01s');
    expect(durationSeconds('01:90:00')).toBeNull();
    expect(durationSeconds('01:30')).toBe(5400);
  });
  it('does not show a fabricated idle distribution for empty or partial time readings', () => {
    const view = component();
    view.runTime = '00:00:00'; view.idleTime = '00:00:00';
    expect(view.recordedSeconds).toBe(0);
    expect(view.runningShare).toBe(0);
    view.runTime = '03:00:00'; view.idleTime = '01:00:00';
    expect(view.runningShare).toBe(75);
    view.idleTime = null;
    expect(view.timeComplete).toBe(false);
  });
  it('keeps adjusted API production counts and displays over-target output without clipping its value', () => {
    const view = component(); view.machineId = 1;
    apply(view, snapshot);
    view.handleSocket({ machine_id: 1, parts_count: 29 });
    expect(view.livePartCount).toBe(59);
    apply(view, { ...snapshot, live: { ...snapshot.live, parts_count: 125 } });
    expect(view.attainment).toBe(125);
    expect(view.overTarget).toBe(25);
    expect(view.remaining).toBe(0);
    expect(view.boundedPercent(view.attainment)).toBe(100);
    view.job.target_qty = 0;
    expect(view.attainment).toBeNull();
  });
  it('applies socket freshness per field and returns to API readings after a stale connection', () => {
    const view = component(); view.machineId = 1;
    apply(view, snapshot);
    view.handleSocket({ machine_id: 1, machine_status: 'IDLE' });
    apply(view, { ...snapshot, live: { ...snapshot.live, spindle_load: 65 } });
    expect(view.liveStatus).toBe('IDLE');
    expect(view.liveSpindleLoad).toBe(65);
    (view as any).socketFields.set('machine_status', Date.now() - 46_000);
    apply(view, snapshot);
    expect(view.liveStatus).toBe('RUNNING');
    view.handleSocket({ machine_id: 2, machine_status: 'OFFLINE', spindle_load: 99 });
    expect(view.liveStatus).toBe('RUNNING');
    expect(view.liveSpindleLoad).toBe(42);
  });
  it('shows alarms independently of running status and clears stale readings on a new snapshot', () => {
    const view = component(); view.machineId = 1;
    apply(view, snapshot);
    view.handleSocket({ machine_id: '1', alarm: true });
    expect(view.displayStatus).toBe('ALARM');
    expect(view.liveStatus).toBe('RUNNING');
    view.handleSocket({ machine_id: 1, alarm: false, spindle_load: null });
    expect(view.displayStatus).toBe('RUNNING');
    expect(view.liveSpindleLoad).toBeNull();
    apply(view, { machine: snapshot.machine });
    expect(view.job).toEqual({});
    expect(view.livePartCount).toBeNull();
  });
});
