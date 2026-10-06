/*
 * The app's menu: one list for the header's desktop bar and phone menu.
 *
 * Grouped deliberately. This was a flat list of fourteen top-level items,
 * which no longer fitted the header: seven of them — Settings and Admin
 * among them — sat outside the visible area with no scrollbar to hint at
 * it, so they simply looked missing.
 *
 * Icons are Material Icons, the one icon family the app uses.
 */
export interface NavItem {
  label: string;
  path?: string;
  /** Material Icons ligature name */
  icon?: string;
  /** one permission, or any of several */
  permission?: string | string[];
  adminOnly?: boolean;
  /** one line for the phone menu: what the page is for */
  hint?: string;
  children?: NavItem[];
}

export const NAV_MENUS: NavItem[] = [
  {
    label: 'Dashboards', icon: 'dashboard',
    children: [
      { label: 'Live Dashboard', path: '/dashboard', icon: 'sensors', permission: 'page:dashboard', hint: 'Every machine, right now' },
      { label: 'Factory Overall', path: '/factory', icon: 'factory', permission: 'page:analytics-factory', hint: 'Whole factory at a glance' },
      { label: 'Maintenance', path: '/maintenance-dashboard', icon: 'build_circle', permission: 'page:analytics-maintenance', hint: 'Machine condition and health' },
      { label: 'Preventive', path: '/preventive-maintenance', icon: 'event_available', permission: 'page:analytics-preventive', hint: 'Planned service by usage' },
      { label: 'Periodic', path: '/periodic-maintenance', icon: 'update', permission: 'page:analytics-periodic', hint: 'Service by calendar' },
      { label: 'Alarms', path: '/alarm-report', icon: 'notifications_active', permission: 'page:analytics-alarms', hint: 'Alarm counts and trends' },
      { label: 'Downtime', path: '/downtime-analysis', icon: 'timer_off', permission: 'page:analytics-downtime', hint: 'Why machines stopped' },
      { label: 'Operators', path: '/operator-performance', icon: 'groups', permission: 'page:analytics-operators', hint: 'Output by operator' },
      { label: 'OEE', path: '/oee-dashboard', icon: 'speed', permission: 'page:analytics-oee', hint: 'Overall Equipment Effectiveness' },
      { label: 'Energy', path: '/energy-dashboard', icon: 'bolt', permission: 'page:analytics-energy', hint: 'Power use and cost' }
    ]
  },
  {
    label: 'Analytics', icon: 'insights',
    children: [
      // one Reports page holds every report, the OEE ones included
      { label: 'Reports', path: '/reports', icon: 'summarize', permission: ['page:reports', 'page:oee-reports'], hint: 'Download production and OEE reports' },
      { label: 'Charts', path: '/charts', icon: 'bar_chart', permission: 'page:charts', hint: 'Parts and run time by hour' },
      { label: 'Quality', path: '/quality', icon: 'verified', permission: 'page:quality', hint: 'Enter rejected and rework parts' },
      { label: 'Maintenance Report', path: '/maintenance-report', icon: 'assignment', permission: 'page:maintenance-report', hint: 'Repairs, tickets and repair time' }
    ]
  },
  { label: 'Alarms', path: '/alarms', icon: 'warning_amber', permission: 'page:alarms', hint: 'Active alarms to resolve' },
  { label: 'Downtime', path: '/downtime', icon: 'pause_circle', permission: 'page:downtime', hint: 'Record why a machine stopped' },
  { label: 'Maintenance', path: '/maintenance', icon: 'handyman', permission: 'page:maintenance', hint: 'Tickets, schedules and logs' },
  {
    /* "Master", as the design names it: the company's setup data. It was
       labelled "Settings", the same word as a person's own Settings page. */
    label: 'Master', icon: 'tune',
    children: [
      { label: 'Machines', path: '/machines', icon: 'precision_manufacturing', permission: 'page:machines' },
      { label: 'Program Transfer', path: '/programs', icon: 'swap_horiz', permission: 'page:programs' },
      { label: 'Component', path: '/component', icon: 'category', permission: 'page:component' },
      { label: 'Job', path: '/job', icon: 'work_outline', permission: 'page:job' },
      { label: 'Lines', path: '/lines', icon: 'linear_scale', permission: 'page:lines' },
      { label: 'Shifts', path: '/shifts', icon: 'schedule', permission: 'page:shifts' },
      { label: 'Operators', path: '/operators', icon: 'badge', permission: 'page:operators' },
      // Tariff & limits, moved off the Energy Dashboard into its own page
      { label: 'Energy Tariff', path: '/energy-tariff', icon: 'payments', permission: 'page:analytics-energy:settings' }
    ]
  },
  /* S&T's whole menu (it opens on Companies). A company admin reaches Users
     and Roles from Settings since 6 Oct 2026, not from the bar. */
  { label: 'Admin', path: '/admin/users', icon: 'admin_panel_settings', adminOnly: true }
];

/** Does `url` show the page at `path`? Whole path segments only:
 *  "/maintenance" must not match "/maintenance-dashboard". */
export function pathMatches(url: string, path: string | undefined): boolean {
  if (!path) return false;
  const clean = url.split(/[?#]/)[0];
  return clean === path || clean.startsWith(path + '/');
}
