import { cycleChartData } from './cycle-time-panel.component';

test('hourly cycle chart preserves gaps and chooses one consistent time unit', () => {
  const view = cycleChartData([
    { hour_start: '2026-11-24T03:00:00Z', cycle_seconds: 120 },
    { hour_start: '2026-11-24T04:00:00Z', cycle_seconds: null },
    { hour_start: '2026-11-24T05:00:00Z', cycle_seconds: 900 }
  ]);
  expect(view.unit).toBe('Min');
  expect(view.points.map(p => p.y)).toEqual([2, null, 15]);
  expect(view.latest).toBe(15);
  expect(cycleChartData([]).latest).toBeNull();
});
