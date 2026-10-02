import { SEVERITY, severityOf } from './severity';

describe('severityOf', () => {
  it('matches the backend word lists', () => {
    for (const w of ['CRITICAL', 'critical', 'Fatal', 'EMERGENCY']) expect(severityOf(w)).toBe('critical');
    for (const w of ['INFO', 'information', 'Informational', 'LOW', 'MESSAGE']) expect(severityOf(w)).toBe('info');
    for (const w of ['NORMAL', 'WARNING', 'MEDIUM', '', null, undefined]) expect(severityOf(w as any)).toBe('noncritical');
  });
  it('says each one in words and with an icon, not by colour alone', () => {
    for (const k of Object.keys(SEVERITY) as (keyof typeof SEVERITY)[]) {
      expect(SEVERITY[k].label).toBeTruthy();
      expect(SEVERITY[k].icon).toBeTruthy();
    }
  });
});
