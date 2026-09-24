import { ProductionChartComponent } from './production-chart.component';

describe('Hourly production chart', () => {
  it('uses one common readable scale and preserves zero and missing hours', () => {
    const chart = new ProductionChartComponent();
    chart.rows = [{ hour: '08:00', produced: 40 }, { hour: '09:00', produced: 0 }, { hour: '10:00', produced: null }, { hour: '11:00', produced: 80 }];
    chart.ngOnChanges();
    expect(chart.total).toBe(120);
    expect(chart.peak).toBe(80);
    expect(chart.max).toBe(80);
    expect(chart.points[1].produced).toBe(0);
    expect(chart.points[2].produced).toBeNull();
    expect(chart.lines.length).toBe(2); // missing readings break the connecting line
    expect(chart.points[0].y).toBe(115);
    expect(chart.points[3].y).toBe(32);
  });
  it('keeps an all-zero series finite and clears an obsolete selection on refresh', () => {
    const chart = new ProductionChartComponent();
    chart.rows = [{ hour: '08:00', produced: 0 }]; chart.selected = 4;
    chart.ngOnChanges();
    expect(chart.max).toBeGreaterThan(0);
    expect(chart.points[0].y).toBe(198);
    expect(chart.selected).toBeNull();
    chart.rows = []; chart.ngOnChanges();
    expect(chart.total).toBe(0);
    expect(chart.lines).toEqual([]);
  });
});
