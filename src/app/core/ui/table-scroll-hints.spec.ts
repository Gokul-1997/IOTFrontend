import { edgeState } from './table-scroll-hints';

describe('edgeState', () => {
  it('is empty when the table fits', () => {
    expect(edgeState(0, 600, 600)).toBe('');
    expect(edgeState(0, 601, 600)).toBe('');
  });
  it('points right at the start, left at the end, both in between', () => {
    expect(edgeState(0, 1000, 600)).toBe('right');
    expect(edgeState(400, 1000, 600)).toBe('left');
    expect(edgeState(200, 1000, 600)).toBe('both');
  });
});
