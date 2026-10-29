import { AlarmsComponent } from './alarms.component';

/* What a row says, from what the machines send (production's rows, 29 Oct 2026). */
const c = Object.create(AlarmsComponent.prototype) as AlarmsComponent;
c.now = Date.parse('2026-10-29T09:00:00Z');

test('the alarm is said once: no "Alarm type:" label, no text said twice', () => {
  expect(c.alarmText({ message: 'Alarm type: ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE' }))
    .toBe('ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE');
  expect(c.alarmText({ message: '(Y)+ OVERTRAVEL ( SOFT 1 ) (axis 2)' })).toBe('(Y)+ OVERTRAVEL ( SOFT 1 ) (axis 2)');
  expect(c.alarmText({ message: null, alarm_type: 'RELEASE EMERGENCY' })).toBe('RELEASE EMERGENCY');
  expect(c.alarmText({ message: 'NO NO' })).toBe('NO NO');                       // too short to be a repeat
});

test('UNSPECIFIED is no text, and gets no tag either', () => {
  expect(c.alarmText({ message: 'UNSPECIFIED', alarm_type: 'UNSPECIFIED' })).toBe('');
  expect(c.kindOf({ message: 'UNSPECIFIED', alarm_type: 'UNSPECIFIED' })).toBe('');
});

test('the kind of event shows only when the text does not already say it', () => {
  expect(c.kindOf({ alarm_type: 'OFFLINE', message: 'Machine stopped sending data' })).toBe('Offline');
  expect(c.kindOf({ alarm_type: 'LOW_PERFORMANCE', message: 'Below 40% for an hour' })).toBe('Low performance');
  expect(c.kindOf({ alarm_type: 'RELEASE EMERGENCY', message: 'RELEASE EMERGENCY' })).toBe('');
  expect(c.kindOf({ alarm_type: 'ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MO', message: 'ATC …' })).toBe('');   // a cut copy of the text
  expect(c.kindOf({ alarm_type: 'ALARM', message: 'x' })).toBe('');
});

test('how long: "for" while on, "lasted" once the machine cleared it, nothing once resolved without an end', () => {
  expect(c.durationText({ started_at: '2026-10-29T06:46:00Z', ended_at: null, is_resolved: false })).toBe('for 2 h 14 min');
  expect(c.durationText({ started_at: '2026-10-27T05:50:00Z', ended_at: null, is_resolved: false })).toBe('for 2 days 3 h');
  expect(c.durationText({ started_at: '2026-10-29T06:00:00Z', ended_at: '2026-10-29T06:04:30Z' })).toBe('lasted 4 min');
  expect(c.durationText({ started_at: '2026-10-29T08:59:40Z', ended_at: null })).toBe('for under a minute');
  expect(c.durationText({ started_at: '2026-10-29T06:00:00Z', ended_at: null, is_resolved: true })).toBe('');
  expect(c.durationText({ started_at: null })).toBe('');
  expect(AlarmsComponent.span(60 * 60_000)).toBe('1 h');
  expect(AlarmsComponent.span(24 * 60 * 60_000)).toBe('1 day');
});

test('still on: not cleared by the machine and not resolved', () => {
  expect(c.stillOn({ ended_at: null, is_resolved: false })).toBe(true);
  expect(c.stillOn({ ended_at: '2026-10-29T06:04:30Z', is_resolved: false })).toBe(false);
  expect(c.stillOn({ ended_at: null, is_resolved: true })).toBe(false);
});

test('the year only when it is not this one', () => {
  expect(c.dateFormat('2026-10-29T06:00:00Z')).toBe('d MMM, h:mm a');
  expect(c.dateFormat('2025-12-31T06:00:00Z')).toBe('d MMM y, h:mm a');
});
