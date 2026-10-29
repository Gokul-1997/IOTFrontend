/*
 * An alarm in the machine's words, said once — the same on Machine Alarms and
 * in a ticket raised from one (29 Oct 2026). Some controllers send
 * "Alarm type: X X": a label and the text twice; "UNSPECIFIED" is no text.
 */
export function alarmText(alarm: { message?: unknown; alarm_type?: unknown } | null | undefined): string {
  let text = String(alarm?.message || alarm?.alarm_type || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^alarm type\s*:\s*/i, '');
  const twice = /^(.{6,}?)\s+\1$/i.exec(text);
  if (twice) text = twice[1];
  return /^(unspecified|unknown|null|none|-+)$/i.test(text) ? '' : text;
}

/** A ticket still being worked on: not resolved, not closed. */
export const isOpenTicket = (status: unknown): boolean =>
  ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(String(status || '').toUpperCase());
