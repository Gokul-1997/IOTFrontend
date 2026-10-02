/*
 * Alarm severity, said the same way on every screen: a word, an icon and a
 * colour together, never the colour alone.
 *
 *   Critical      red     error            stops the machine or needs action now
 *   Non-critical  amber   warning_amber    a fault or condition to deal with
 *   Information   blue    info             a message, nothing is wrong
 *
 * The backend classes alarms the same three ways (Backend/src/dashboard/
 * severity.js). Its "NORMAL" (the Alarm Report's filter value) means
 * "not critical", which is what the screens now say: "Normal" read as
 * "nothing wrong" to people who are not maintenance staff.
 */
export type SeverityKind = 'critical' | 'noncritical' | 'info';

export interface SeverityStyle { label: string; icon: string; color: string; badge: string; }

export const SEVERITY: Record<SeverityKind, SeverityStyle> = {
  critical:    { label: 'Critical',     icon: 'error',         color: '#dc2626', badge: 'mexa-badge-bad' },
  noncritical: { label: 'Non-critical', icon: 'warning_amber', color: '#d97706', badge: 'mexa-badge-warn' },
  info:        { label: 'Information',  icon: 'info',          color: '#2563eb', badge: 'mexa-badge-info' }
};

/** CRITICAL → critical; INFO / INFORMATION → info; anything else is non-critical. */
export function severityOf(raw: string | null | undefined): SeverityKind {
  const s = String(raw || '').trim().toUpperCase();
  // the same word lists as the backend's severityClass()
  if (['CRITICAL', 'FATAL', 'EMERGENCY'].includes(s)) return 'critical';
  if (['INFO', 'INFORMATION', 'INFORMATIONAL', 'LOW', 'MESSAGE'].includes(s)) return 'info';
  return 'noncritical';
}

/** An alarm that is still on (not yet cleared or resolved) versus one that is over. */
export const ALARM_STATE = {
  open:   { label: 'Open',   icon: 'notifications_active', badge: 'mexa-badge-warn' },
  closed: { label: 'Closed', icon: 'check_circle',         badge: 'mexa-badge-good' }
};
