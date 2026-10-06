import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
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
  let answer: () => any;
  let panel: MeterPanelComponent;
  const withMeter = { status: 'success', data: { meters: [{ id: 15, serial: 'VMC - 1 - F' }], machine: { id: 15, serial: 'VMC - 1 - F' } } };
  const noMeter = { status: 'success', data: { meters: [], machine: null } };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = 0;
    const api: any = { forEnergy: () => { calls++; return answer(); } };
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
    expect(panel.visible).toBe(false);
    answer = () => of(withMeter);
    vi.advanceTimersByTime(30_000);
    expect(calls).toBe(2);
    expect(panel.visible).toBe(true);
  });
});
