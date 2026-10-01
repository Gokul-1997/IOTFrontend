/**
 * When a dashboard's figures were fetched, in words a shift reads at a
 * glance: "today, 7:47 pm" or "30 Sep, 7:47 pm". It replaced the full
 * locale timestamp ("1/10/2026, 7:47:00 pm"), which is slower to read and
 * wrapped onto three lines beside the page title on a phone.
 */
export function updatedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `today, ${time}` : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}
