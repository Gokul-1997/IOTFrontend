import { compactQty, qty } from './format-number';

describe('qty', () => {
  it('groups digits the Indian way and keeps one decimal', () => {
    expect(qty(2259911320)).toBe('2,25,99,11,320');
    expect(qty(1234.56)).toBe('1,234.6');
    expect(qty('42')).toBe('42');
  });
  it('says "--" for a missing figure, never "0"', () => {
    expect(qty(null)).toBe('--');
    expect(qty(undefined)).toBe('--');
    expect(qty('')).toBe('--');
    expect(qty('n/a')).toBe('--');
    expect(qty(0)).toBe('0');
  });
});

describe('compactQty', () => {
  it('shortens big axis values to lakh and crore', () => {
    expect(compactQty(950)).toBe('950');
    expect(compactQty(150000)).toBe('1.5L');
    expect(compactQty(300000000)).toBe('30Cr');
  });
  it('keeps small values, rounded to one decimal', () => {
    expect(compactQty(12.345)).toBe('12.3');
    expect(compactQty(null)).toBe('');
  });
});
