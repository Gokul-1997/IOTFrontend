import { describe, expect, it } from 'vitest';
import { lostCostLine } from './lost-cost';

describe('lostCostLine', () => {
  it('every machine priced: the figure alone, in Indian grouping', () => {
    expect(lostCostLine(176040, 17, 17)).toBe('₹1,76,040');
  });

  it('some machines priced: says how many the figure covers', () => {
    expect(lostCostLine(5600, 2, 17)).toBe('₹5,600 · 2 of 17 machines');
  });

  it('none priced: says so, never ₹0', () => {
    expect(lostCostLine(null, 0, 17)).toBe('No hour rates set');
  });

  it('nothing reported, or an API that sends no cost yet: no line', () => {
    expect(lostCostLine(null, 0, 0)).toBe('');
    expect(lostCostLine(undefined, undefined, undefined)).toBe('');
  });

  it('a real ₹0 (no idle time) is shown as ₹0', () => {
    expect(lostCostLine(0, 3, 3)).toBe('₹0');
  });
});
