import { updatedLabel } from './updated-label';

describe('updatedLabel', () => {
  const now = new Date(2026, 9, 1, 20, 0);   // 1 Oct 2026, 8 pm local

  it('reads "today" for a time earlier the same day', () => {
    expect(updatedLabel(new Date(2026, 9, 1, 19, 47).toISOString(), now)).toMatch(/^today, 7:47\s?pm$/i);
  });

  it('names the day for anything older', () => {
    expect(updatedLabel(new Date(2026, 8, 30, 19, 47).toISOString(), now)).toMatch(/^30 Sept?, 7:47\s?pm$/i);
  });

  it('is empty when there is no time, or it cannot be read', () => {
    expect(updatedLabel(null, now)).toBe('');
    expect(updatedLabel(undefined, now)).toBe('');
    expect(updatedLabel('not a date', now)).toBe('');
  });
});
