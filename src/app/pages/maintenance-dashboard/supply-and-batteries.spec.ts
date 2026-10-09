import { supplyView } from './supply-voltage.component';
import { axisBatteries } from './axis-batteries.component';

const limits = { ll_nominal: 415, ln_nominal: 240, tolerance_pct: 10, imbalance_pct: 2 };
const reading = (o: any = {}) => ({
  read_at: '2026-10-09T06:30:15Z', stale: false, limits,
  ln: { v1n: 242.3, v2n: 243.79, v3n: 242.22, avg: 242.77 },
  ll: { v12: 421.2, v23: 421.16, v31: 419.12, avg: 420.49 },
  ...o
});

describe('supplyView', () => {
  it('two groups, L-N then L-L, each phase to one decimal, with its average and imbalance', () => {
    const v = supplyView(reading())!;
    expect(v.groups.map(g => g.short)).toEqual(['L-N', 'L-L']);
    expect(v.groups[0].phases.map(p => `${p.label} ${p.value}`)).toEqual(['L1-N 242.3', 'L2-N 243.8', 'L3-N 242.2']);
    expect(v.groups[1].phases.map(p => `${p.label} ${p.value}`)).toEqual(['L1-L2 421.2', 'L2-L3 421.2', 'L3-L1 419.1']);
    expect(v.groups.map(g => g.avg)).toEqual(['242.8', '420.5']);
    expect(v.groups.map(g => g.imbalance)).toEqual(['0.4 %', '0.3 %']);
    expect(v.word).toBe('Healthy');
    expect(v.problem).toBe('');
  });

  it('a phase more than 10 % off its nominal is out and Critical, and named', () => {
    const v = supplyView(reading({ ln: { v1n: 242.3, v2n: 205.1, v3n: 242.2, avg: 229.9 } }))!;
    expect(v.groups[0].phases.map(p => p.out)).toEqual([false, true, false]);
    expect(v.word).toBe('Critical');
    expect(v.problem).toBe('L2-N 205.1 V');
    // 10 % is the line: 373.5 and 456.5 are still in, phase to phase
    const edge = supplyView(reading({ ll: { v12: 373.5, v23: 456.5, v31: 415, avg: 415 } }))!;
    expect(edge.groups[1].phases.some(p => p.out)).toBe(false);
  });

  it('all in tolerance but over 2 % apart: Stable, saying which group', () => {
    const v = supplyView(reading({ ll: { v12: 430, v23: 410, v31: 405, avg: 415 } }))!;
    expect(v.word).toBe('Stable');
    expect(v.problem).toBe('L-L 3.6 % apart');
  });

  it('a missing phase shows "--", is never out, and leaves the imbalance unknown', () => {
    const v = supplyView(reading({ ln: { v1n: null, v2n: 243.79, v3n: '242.22', avg: null } }))!;
    expect(v.groups[0].phases.map(p => p.value)).toEqual(['--', '243.8', '242.2']);
    expect(v.groups[0].phases.some(p => p.out)).toBe(false);
    expect(v.groups[0].imbalance).toBe('--');
    expect(v.groups[0].avg).toBe('--');
  });

  it('nothing to show: null; no reading at all: no word', () => {
    expect(supplyView(null)).toBeNull();
    expect(supplyView({ ln: {}, ll: {} })).toBeNull();
    const empty = supplyView(reading({ ln: { v1n: null, v2n: null, v3n: null, avg: null }, ll: { v12: null, v23: null, v31: null, avg: null } }))!;
    expect(empty.word).toBe('');
  });

  it('keeps the stale flag and never prints "Invalid Date"', () => {
    expect(supplyView(reading({ stale: true }))!.stale).toBe(true);
    expect(supplyView(reading({ read_at: 'garbage' }))!.at).toBe('');
  });
});

describe('axisBatteries', () => {
  it('one per axis, in the machine\'s order, true = low', () => {
    expect(axisBatteries({ B: false, W: true, X: false, Y: true, Z: false, A: false })).toEqual([
      { axis: 'X', low: false }, { axis: 'Y', low: true }, { axis: 'Z', low: false },
      { axis: 'A', low: false }, { axis: 'B', low: false }, { axis: 'W', low: true }
    ]);
  });

  it('an axis without a true/false is left out; nothing or a wrong shape is none', () => {
    expect(axisBatteries({ X: false, Y: 'low', Z: null })).toEqual([{ axis: 'X', low: false }]);
    expect(axisBatteries(null)).toEqual([]);
    expect(axisBatteries([true, false])).toEqual([]);
    expect(axisBatteries('X')).toEqual([]);
  });
});
