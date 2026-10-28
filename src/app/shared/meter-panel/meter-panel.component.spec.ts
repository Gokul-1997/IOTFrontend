import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { fmt, fmtAuto, hzBand, imbalancePct, MeterLimits, MeterPanelComponent, niceBounds, pfBand, voltageBand } from './meter-panel.component';

const limits: MeterLimits = {
  v_ll_nominal: 415, v_tolerance_pct: 10, pf_good: 0.95, pf_low: 0.9,
  hz_min: 49.5, hz_max: 50.5, v_imbalance_pct: 2, i_imbalance_pct: 10
};

describe('meter panel helpers', () => {
  it('formats to fixed decimals, and says -- for nothing', () => {
    expect(fmt(416.7300109863281, 1)).toBe('416.7');
    expect(fmt(null)).toBe('--');
    expect(fmt(NaN)).toBe('--');
    expect(fmt(Infinity)).toBe('--');
    expect(fmtAuto(-Infinity)).toBe('--');
    expect(fmtAuto(1.24399995803833)).toBe('1.24');
    expect(fmtAuto(14.970000267028809)).toBe('15.0');
    expect(fmtAuto(-0.7303835153579712)).toBe('-0.73');
  });

  it('imbalance is the furthest phase from the average, as a % of it', () => {
    // VMC - 1 - F, 3 Oct 2026: 418.06, 416.20, 415.93 V → 0.3 %
    expect(imbalancePct([418.06, 416.2, 415.93])).toBeCloseTo(0.315, 2);
    expect(imbalancePct([10, 10, 13])).toBeCloseTo(18.18, 1);
    expect(imbalancePct([1, null, 1])).toBeNull();
    expect(imbalancePct([0, 0, 0])).toBeNull();
  });

  it('phase-to-phase voltage against 415 V ±10 %', () => {
    expect(voltageBand(416.73, limits)?.label).toBe('Within limits');
    expect(voltageBand(370, limits)?.label).toBe('Low');
    expect(voltageBand(460, limits)?.label).toBe('High');
    expect(voltageBand(null, limits)).toBeNull();
  });

  it('power factor is judged by its size, so a reversed meter still reads Low, Fair or Good', () => {
    expect(pfBand(-0.836, limits)?.label).toBe('Low');
    expect(pfBand(0.92, limits)?.label).toBe('Fair');
    expect(pfBand(-0.97, limits)?.label).toBe('Good');
  });

  it('frequency outside 49.5–50.5 Hz is out of range', () => {
    expect(hzBand(49.958, limits)?.label).toBe('Normal');
    expect(hzBand(49.2, limits)?.label).toBe('Out of range');
  });

  it('missing or nonfinite readings never receive reassuring electrical bands', () => {
    for (const value of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(voltageBand(value, limits)).toBeNull();
      expect(pfBand(value, limits)).toBeNull();
      expect(hzBand(value, limits)).toBeNull();
    }
  });

  it('axis bounds are round numbers that hold the data', () => {
    expect(niceBounds(-0.83, 0)).toEqual({ min: -1, max: 0, ticks: 5 });
    expect(niceBounds(0, 3.14)).toEqual({ min: 0, max: 4, ticks: 4 });
    expect(niceBounds(-2.2, 0.09)).toEqual({ min: -2.5, max: 0.5, ticks: 6 });
    const b = niceBounds(0, 0.0167);
    expect(b.min).toBe(0);
    expect(b.max).toBeGreaterThanOrEqual(0.0167);
    expect(b.ticks).toBeLessThanOrEqual(6);
  });
});

/* The panel asks the server every 30 s only while that is worth it: a meter
   on show, in a tab someone can see. A company with no meter is asked once. */
describe('meter panel polling', () => {
  let calls: number;
  let answer: (id?: number | null, range?: string) => any;
  let requested: { id: number | null; range: string }[];
  let panel: MeterPanelComponent;
  const withMeter = { status: 'success', data: { meters: [{ id: 15, serial: 'VMC - 1 - F' }, { id: 34, serial: 'VMC - 13 - M' }], machine: { id: 15, serial: 'VMC - 1 - F' }, latest: { at: Date.now(), kw_total: -0.73, stale: false } } };
  const noMeter = { status: 'success', data: { meters: [], machine: null } };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = 0;
    requested = [];
    const api: any = { forEnergy: (id: number | null, range: string) => { calls++; requested.push({ id, range }); return answer(id, range); } };
    panel = new MeterPanelComponent(api, { markForCheck() {} } as any);
  });
  afterEach(() => {
    panel.ngOnDestroy();
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('a company with no meter is asked once, and shown nothing', () => {
    answer = () => of(noMeter);
    panel.ngOnInit();
    vi.advanceTimersByTime(5 * 60_000);
    expect(calls).toBe(1);
    expect(panel.visible).toBe(false);
  });

  it('a meter on show is asked again every 30 s', () => {
    answer = () => of(withMeter);
    panel.ngOnInit();
    expect(panel.visible).toBe(true);
    vi.advanceTimersByTime(90_000);
    expect(calls).toBe(4);
  });

  it('not while the browser tab is in the background', () => {
    answer = () => of(withMeter);
    panel.ngOnInit();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    vi.advanceTimersByTime(90_000);
    expect(calls).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    vi.advanceTimersByTime(30_000);
    expect(calls).toBe(2);
  });

  it('a first answer that failed is tried again: it is not yet known there is no meter', () => {
    answer = () => throwError(() => new Error('offline'));
    panel.ngOnInit();
    expect(panel.visible).toBe(true);
    expect(panel.state).toBe('error');
    answer = () => of(withMeter);
    vi.advanceTimersByTime(30_000);
    expect(calls).toBe(2);
    expect(panel.visible).toBe(true);
  });

  it('clears old readings while changing machines and rejects an answer for a different machine', () => {
    answer = () => of(withMeter);
    panel.ngOnInit();
    const delayed = new Subject<any>();
    answer = () => delayed;
    panel.setMachine(34);
    expect(panel.state).toBe('loading');
    expect(panel.data).toBeNull();
    expect(panel.latest).toBeNull();
    expect(panel.machine.id).toBe(34);
    delayed.next(withMeter); // an incorrect server response for machine 15
    expect(panel.state).toBe('error');
    expect(panel.data).toBeNull();
    expect(panel.latest).toBeNull();
    expect(requested.at(-1)?.id).toBe(34);
  });

  it('cancels obsolete requests and never applies their late readings', () => {
    const old = new Subject<any>();
    answer = () => old;
    panel.ngOnInit();
    answer = id => of({ ...withMeter, data: { ...withMeter.data, machine: { id, serial: 'Selected machine' } } });
    panel.machineId = 34;
    panel.ngOnChanges();
    old.next(withMeter);
    expect(panel.data.machine.id).toBe(34);
    expect(panel.state).toBe('ready');
  });

  it('the parent machine filter overrides the local meter selector and is retained when polling', () => {
    answer = id => of({ ...withMeter, data: { ...withMeter.data, machine: { id, serial: 'Selected machine' } } });
    panel.machineId = 34;
    panel.ngOnChanges();
    panel.ngOnInit();
    panel.setMachine(15);
    vi.advanceTimersByTime(30_000);
    expect(requested.map(r => r.id)).toEqual([34, 34]);
    expect(panel.machine.id).toBe(34);
    panel.machineId = null;
    answer = () => of(withMeter);
    panel.ngOnChanges();
    expect(requested.at(-1)?.id).toBeNull();
    expect(panel.machine.id).toBe(15);
  });

  it('an update failure clears values, keeps the selected machine and retries that machine', () => {
    answer = () => of(withMeter);
    panel.ngOnInit();
    answer = () => throwError(() => new Error('offline'));
    vi.advanceTimersByTime(30_000);
    expect(panel.data).toBeNull();
    expect(panel.latest).toBeNull();
    expect(panel.asOf).toBe('Readings could not be updated');
    expect(panel.machine.id).toBe(15);
    answer = () => of(withMeter);
    panel.reload();
    expect(requested.at(-1)?.id).toBe(15);
    expect(panel.state).toBe('ready');
  });

  it('a delayed refresh marks the retained reading stale based on its actual timestamp', () => {
    answer = () => of(withMeter);
    panel.ngOnInit();
    answer = () => new Subject<any>();
    vi.advanceTimersByTime(121_000);
    expect(panel.latest.stale).toBe(true);
    panel.data = { ...panel.data, latest: { at: Date.now() + 1, stale: false } };
    expect(panel.latest).toBeNull();
  });

  it('unknown consumption stays -- while measured zero remains zero', () => {
    panel.metric = 'kwh';
    panel.data = { summary: { kwh_used: null, kwh_import: null, kwh_export: null, kvarh: null, kvah: null } };
    expect(panel.stats[0].value).toBe('--');
    panel.data.summary.kwh_used = 0;
    expect(panel.stats[0].value).toBe('0.00');
  });
});
