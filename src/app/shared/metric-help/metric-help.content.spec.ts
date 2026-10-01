import { metricHelp } from './metric-help.content';

/*
 * The (i) panels quote formulas and worked examples. They are only useful if
 * the arithmetic is right and matches what the backend calculates, so the
 * shared example is recomputed here from the same figures.
 */
describe('metricHelp', () => {

  // every topic a template asks for (grep "app-metric-help" and reports.ts)
  const used = [
    'oee', 'availability', 'performance', 'quality', 'produced', 'run_time', 'idle_time',
    'downtime_reasons', 'declared_downtime', 'onoff_availability', 'unaccounted', 'alarm_time', 'mttr',
    'target', 'accepted', 'rejected', 'rework', 'utilization', 'running_share', 'production_vs_target',
    'machine_status', 'run_hours', 'energy_total', 'efficiency',
    'avg_oee', 'avg_availability', 'avg_performance', 'avg_quality'
  ];

  it('has words for every topic the screens use', () => {
    for (const t of used) {
      const e = metricHelp(t);
      expect(e.what, t).not.toBe('');
      expect(e.title, t).not.toBe(t);
    }
  });

  it('works the shared example through the real formulas', () => {
    // 660 planned min, 495 run, 2-min cycle, 198 made, 6 rejected, 2 rework
    const a = 495 / 660;                       // run ÷ planned
    const p = Math.min(1, 198 / (495 / 2));    // made ÷ possible, capped at 100 %
    const q = (198 - 6 - 2) / 198;             // good ÷ made
    expect(Math.round(a * 100)).toBe(75);
    expect(Math.round(p * 100)).toBe(80);
    expect(Math.round(q * 100)).toBe(96);
    expect((a * p * q * 100).toFixed(1)).toBe('57.6');

    expect(metricHelp('availability').example).toContain('495 ÷ 660 = 75 %');
    expect(metricHelp('performance').example).toContain('198 ÷ 247.5 = 80 %');
    expect(metricHelp('quality').example).toContain('190 ÷ 198 = 96 %');
    expect(metricHelp('oee').example).toContain('= OEE 57.6 %');
  });

  it('says which planned time a screen uses', () => {
    expect(metricHelp('availability', 'shift').formula!.join(' ')).toContain('shift length minus its breaks');
    expect(metricHelp('availability', 'period').formula!.join(' ')).toContain('switched on and sending data');
  });

  it('says how a missing cycle time shows on each kind of screen', () => {
    expect(metricHelp('performance', 'period').why).toContain('"--"');
    expect(metricHelp('performance', 'shift').why).toContain('0 %');
  });

  it('explains report averages as averages of rows', () => {
    const e = metricHelp('avg_oee');
    expect(e.title).toBe('Average OEE');
    expect(e.formula![0]).toContain('÷ number of rows');
    expect(e.example).toContain('(60 + 50 + 70) ÷ 3 = 60 %');
  });

  it('falls back to the topic name for an unknown topic', () => {
    expect(metricHelp('nope')).toEqual({ title: 'nope', what: '' });
  });
});
