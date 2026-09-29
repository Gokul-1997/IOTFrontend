import { Component, HostListener, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/notification-bell/notification-bell.component';
import { MatIconModule } from '@angular/material/icon';
import { SocketService } from '../../core/services/socket.service';
import { BRAND } from '../../brand';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule, IconComponent, NotificationBellComponent, MatIconModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent implements OnInit, OnDestroy {
  private routeSubscription?: Subscription;
  private grantsSub?: Subscription;
  homeRoute = "/dashboard";
  readonly brand = BRAND;
  /** The app bar gains a shadow once the page scrolls under it. */
  scrolled = false;

  openMenu: string | null = null;
  showUserMenu = false;
  userName = 'Admin';
  userEmail = '';
  userRole = '';
  companyName = '';
  planName = '';

  isAdmin = false;
  isSntSuper = false;

  // Organize the workflow while retaining route permission boundaries.
  allMenus: any[] = [
    {
      label: 'Dashboards', icon: 'dashnew',
      children: [
        { label: 'Live Dashboard', path: '/dashboard', permission: 'page:dashboard', icon: 'monitoring', hint: 'Every machine, as it runs' },
        { label: 'Factory Overall', path: '/factory', permission: 'page:analytics-factory', icon: 'factory', hint: 'The whole plant at a glance' },
        { label: 'Maintenance', path: '/maintenance-dashboard', permission: 'page:analytics-maintenance', icon: 'build', hint: 'Machine condition and health' },
        { label: 'Preventive', path: '/preventive-maintenance', permission: 'page:analytics-preventive', icon: 'event_available', hint: 'Planned maintenance' },
        { label: 'Periodic', path: '/periodic-maintenance', permission: 'page:analytics-periodic', icon: 'event_repeat', hint: 'Recurring checks' },
        { label: 'Alarms', path: '/alarm-report', permission: 'page:analytics-alarms', icon: 'notifications_active', hint: 'Alarm report' },
        { label: 'Downtime', path: '/downtime-analysis', permission: 'page:analytics-downtime', icon: 'timer_off', hint: 'Why machines stopped' },
        { label: 'Operators', path: '/operator-performance', permission: 'page:analytics-operators', icon: 'badge', hint: 'Operator performance' },
        { label: 'OEE', path: '/oee-dashboard', permission: 'page:analytics-oee', icon: 'speed', hint: 'Availability × performance × quality' },
        { label: 'Energy', path: '/energy-dashboard', permission: 'page:analytics-energy', icon: 'bolt', hint: 'Consumption and cost' }
      ]
    },
    {
      label: 'Analytics', icon: 'donutnew',
      children: [
        // one Reports page holds every report, the OEE ones included
        { label: 'Reports', path: '/reports', permission: ['page:reports', 'page:oee-reports'], icon: 'description', hint: 'Production and OEE reports' },
        { label: 'Charts', path: '/charts', permission: 'page:charts', icon: 'bar_chart', hint: 'Part-wise run, idle and counts' },
        { label: 'Quality', path: '/quality', permission: 'page:quality', icon: 'verified', hint: 'Produced, rejected, accepted' },
        { label: 'Maintenance Report', path: '/maintenance-report', permission: 'page:maintenance-report', icon: 'receipt_long', hint: 'The maintenance ticket record' }
      ]
    },
    { label: 'Alarms', path: '/alarms', icon: 'alerts', permission: 'page:alarms' },
    { label: 'Downtime', path: '/downtime', icon: 'downtime', permission: 'page:downtime' },
    { label: 'Maintenance', path: '/maintenance', icon: 'maintenance', permission: 'page:maintenance' },
    {
      /* "Master", as the design names it: the company's setup data. It was
         labelled "Settings", the same word as a person's own Settings page. */
      label: 'Master', icon: 'gearnew',
      children: [
        { label: 'Machines', path: '/machines', permission: 'page:machines', icon: 'precision_manufacturing', hint: 'Machines and their setup' },
        { label: 'Program Transfer', path: '/programs', permission: 'page:programs', icon: 'upload_file', hint: 'Send programs to machines' },
        { label: 'Component', path: '/component', permission: 'page:component', icon: 'category', hint: 'Parts and components' },
        { label: 'Job', path: '/job', permission: 'page:job', icon: 'work', hint: 'Jobs on machines' },
        { label: 'Lines', path: '/lines', permission: 'page:lines', icon: 'linear_scale', hint: 'Production lines' },
        { label: 'Shifts', path: '/shifts', permission: 'page:shifts', icon: 'schedule', hint: 'Shift times and breaks' },
        { label: 'Operators', path: '/operators', permission: 'page:operators', icon: 'groups', hint: 'People on the floor' },
        { label: 'Plants', path: '/plants', permission: 'page:plants', icon: 'domain', hint: 'Sites' },
        { label: 'Machine Shifts', path: '/machine-shifts', permission: 'page:machine-shifts', icon: 'event_note', hint: 'Shift calendar per machine' },
        // Tariff & limits, moved off the Energy Dashboard into its own page
        { label: 'Energy Tariff', path: '/energy-tariff', permission: 'page:analytics-energy:settings', icon: 'payments', hint: 'Cost per kWh and limits' }
        /* 2FA Security moved to the account menu: it is about the person, and
           with no permission it made this menu appear for every role. */
      ]
    },
    { label: 'Admin', path: '/admin/users', icon: 'shield', adminOnly: true } 
  ];

  menus: any[] = [];

  constructor(
    private router: Router,
    private auth: AuthService,
    public  theme: ThemeService,
    public  socket: SocketService,
    private cdr: ChangeDetectorRef
  ) {}

  /*
   * The app runs zoneless (Angular 21, no zone.js). Flipping openMenu or
   * showUserMenu schedules no render on its own, so both header dropdowns
   * changed state and never appeared — the Settings menu looked missing and
   * the user menu did nothing. Every handler that changes them has to say so.
   */
  private touch() { this.cdr.markForCheck(); }

  /** Closes the user-menu dropdown after a link inside it is followed —
   *  public because the template calls it directly. */
  closeUserMenu(): void {
    this.showUserMenu = false;
    this.touch();
  }

  ngOnInit() {
    const user = this.auth.getUser();
    this.userName    = user.username || user.company_name || 'Admin';
    this.userEmail   = user.email || '';
    this.isSntSuper  = this.auth.isSntSuper();
    this.isAdmin     = this.auth.isAdmin();
    this.userRole    = this.isSntSuper ? 'Platform Admin'
                     : user.roles?.includes('COMPANY_ADMIN') ? 'Company Admin'
                     : user.roles?.[0] || 'User';
    this.planName    = user.plan?.plan_name || '';
    this.companyName = user.company_name || '';

    // SNT_SUPER: show Companies as the admin landing
    if (this.isSntSuper) {
      this.allMenus = this.allMenus.map(m =>
        m.adminOnly ? { ...m, label: 'Admin', path: '/admin/companies' } : m
      );
    }

    this.buildMenus();
    this.homeRoute = this.auth.getFirstAccessibleRoute();
    this.openMenu = null;
    this.routeSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isMobileMenuOpen = false;
        this.showUserMenu = false;
        this.openMenu = null;
        this.touch();
      }
    });

    // A refresh that brought different grants: rebuild, so a page the company
    // just lost stops appearing in the bar without a reload.
    this.grantsSub = this.auth.grantsChanged$.subscribe(() => {
      this.buildMenus();
      this.touch();
    });
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.grantsSub?.unsubscribe();
  }

  buildMenus() {
    // SNT_SUPER only sees Admin pages — no dashboard/reports/master
    if (this.isSntSuper) {
      this.menus = this.allMenus.filter(m => m.adminOnly);
      return;
    }

    this.menus = this.allMenus
      .map(menu => {
        if (menu.adminOnly) return this.isAdmin ? menu : null;

        if (menu.children) {
          const filteredChildren = menu.children.filter((child: any) =>
            this.allowed(child.permission)
          );
          return filteredChildren.length > 0 ? { ...menu, children: filteredChildren } : null;
        }

        return this.allowed(menu.permission) ? menu : null;
      })
      .filter(m => m !== null);
  }


  private canAccess(permission: string): boolean {
    // Keep navigation aligned with permissionGuard, including legacy ADMIN users.
    if (this.auth.getRoles().includes('ADMIN') || this.auth.isCompanyAdmin()) {
      const permissions = this.auth.getCompanyPermissions();
      return permissions.length === 0 || permissions.some(p => p === permission || p.startsWith(permission + ':'));
    }
    return this.auth.hasPermission(permission);
  }

  get pageName(): string {
    if (this.router.url.startsWith('/dashboard/live/')) return 'Machine workspace';
    const pages = this.allMenus.flatMap(menu => menu.children || [menu]);
    return pages.find(page => this.isActive(page.path))?.label || 'Workspace';
  }

  get initials(): string { return this.userName.slice(0, 2).toUpperCase(); }

  toggleUserMenu() { this.showUserMenu = !this.showUserMenu; this.touch(); }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  /** No permission, one, or any of several (a page more than one grant opens). */
  private allowed(p: string | string[] | undefined): boolean {
    if (!p) return true;
    return Array.isArray(p) ? p.some(k => this.canAccess(k)) : this.canAccess(p);
  }

  toggleMenu(label: string) { this.openMenu = this.openMenu === label ? null : label; this.touch(); }
  closeMenu() { this.openMenu = null; this.touch(); }

  navigate(menu: any) {
    this.router.navigate([menu.path]);
    this.isMobileMenuOpen = false;
    this.touch();
  }

  isActive(path: string) { return this.router.url.split(/[?#]/)[0] === path; }
  isChildActive(children: any[]) { return children?.some(c => this.router.url.startsWith(c.path)); }

  /* State and persistence now live in ThemeService — before this, isDark
     was a plain component field, always initialised to false, with nothing
     reading or writing localStorage. It survived route changes (the header
     sits outside <router-outlet>) but not a reload or a new tab: dark mode
     never actually stuck. */
  toggleTheme() { this.theme.toggle(); }

  isMobileMenuOpen = false;
  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
    this.touch();
    if (!this.isMobileMenuOpen) document.getElementById('gokul-menu-toggle')?.focus();
  }

  @HostListener('window:scroll')
  onScroll() {
    const scrolled = window.scrollY > 4;
    if (scrolled !== this.scrolled) { this.scrolled = scrolled; this.touch(); }
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const before = `${this.openMenu}|${this.showUserMenu}`;
    if (!target.closest('.user-menu-wrap')) this.showUserMenu = false;
    if (!target.closest('.nav-group')) this.openMenu = null;
    // only repaint when something actually closed
    if (before !== `${this.openMenu}|${this.showUserMenu}`) this.touch();
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (!this.isMobileMenuOpen && this.openMenu) {
      (document.querySelector('.nav-group button[aria-expanded="true"]') as HTMLElement | null)?.focus();
    }
    this.showUserMenu = false;
    this.openMenu = null;
    if (this.isMobileMenuOpen) this.toggleMobileMenu();
    this.touch();
  }
}
