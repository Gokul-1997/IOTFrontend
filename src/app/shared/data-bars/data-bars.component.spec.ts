import { DataBarsComponent } from './data-bars.component';

describe('Comparable measurements', () => {
  it('preserves missing, zero and out-of-range readings without inventing a value', () => {
    const view = new DataBarsComponent();
    view.scaleMax = 100;
    view.unit = '%';
    expect(view.display(null)).toBe('Not reported');
    expect(view.display(0)).toBe('0%');
    expect(view.width(140)).toBe(100);
    expect(view.display(140)).toBe('140%');
    expect(view.width(-3)).toBe(0);
    expect(view.display(NaN)).toBe('Not reported');
  });
  it('compares values on one common scale and safely handles an empty distribution', () => {
    const view = new DataBarsComponent();
    view.values = [10, 20, null];
    expect(view.width(10)).toBe(50);
    expect(view.width(20)).toBe(100);
    view.values = [0, 0];
    expect(view.width(0)).toBe(0);
  });
  it('formats duration values from API seconds, retaining sub-minute readings', () => {
    const view = new DataBarsComponent();
    view.duration = true;
    expect(view.display(42)).toBe('42s');
    expect(view.display(5400)).toBe('1h 30m');
    expect(view.display(null)).toBe('Not reported');
  });
});
