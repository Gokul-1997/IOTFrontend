import { qty } from './format-number';

/**
 * Lost time in rupees, for a KPI's line: what idle or alarm time cost at each
 * machine's hour rate (set on the machine, Master → Machines). When not every
 * machine has a rate it says how many the figure covers; when none has, it
 * says so — never "₹0", which would claim the lost time cost nothing.
 */
export function lostCostLine(cost: number | null | undefined,
                             priced: number | null | undefined,
                             of: number | null | undefined): string {
  if (cost === null || cost === undefined) return (of ?? 0) > 0 ? 'No hour rates set' : '';
  const covered = priced != null && of != null && priced < of ? ` · ${priced} of ${of} machines` : '';
  return `₹${qty(cost, 0)}${covered}`;
}

/** Where the rupee figures come from, for a tooltip. */
export const LOST_COST_HINT = 'Hours lost × each machine’s hour rate, set on the machine in Master → Machines';
