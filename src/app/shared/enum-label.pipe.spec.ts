import { EnumLabelPipe } from './enum-label.pipe';

describe('EnumLabelPipe', () => {
  const label = new EnumLabelPipe();

  it('turns a stored code into words', () => {
    expect(label.transform('IN_PROGRESS')).toBe('In progress');
    expect(label.transform('MEDIUM')).toBe('Medium');
    expect(label.transform('BREAKDOWN')).toBe('Breakdown');
    expect(label.transform('NON__CRITICAL_')).toBe('Non critical');
  });

  it('leaves nothing for nothing, and copes with numbers', () => {
    expect(label.transform(null)).toBe('');
    expect(label.transform(undefined)).toBe('');
    expect(label.transform('')).toBe('');
    expect(label.transform(3)).toBe('3');
  });
});
