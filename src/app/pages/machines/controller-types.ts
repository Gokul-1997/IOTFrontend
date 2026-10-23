/**
 * A machine's controller type (machines.controller_type, migration 060 —
 * 23 Oct 2026, the user: "one more dropdown for the controller: Fanuc or
 * Mitsubishi"). Next to the Controller text (its model); the company's
 * gateway gets it in GET /status to know how to talk to the CNC.
 */
export const CONTROLLER_TYPES: readonly { value: string; label: string }[] = [
  { value: 'FANUC', label: 'Fanuc' },
  { value: 'MITSUBISHI', label: 'Mitsubishi' }
];

/** "Fanuc", "Mitsubishi" — or '' when not set. */
export const controllerTypeLabel = (value: string | null | undefined): string =>
  CONTROLLER_TYPES.find(t => t.value === value)?.label ?? '';
