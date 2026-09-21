import { Component, HostListener, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { IconComponent } from '../../shared/icon/icon';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/notification-bell/notification-bell.component';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule, IconComponent, NotificationBellComponent],
  templateUrl: './header.component.html',
})
export class HeaderComponent implements OnInit, OnDestroy {

  private grantsSub?: Subscription;

  openMenu: string | null = null;
  showUserMenu = false;
  userName = 'Admin';
  userEmail = '';
  userRole = '';
  companyName = '';
  planName = '';

  isAdmin = false;
  isSntSuper = false;

  // All menus with permission keys for filtering
  /*
   * Grouped deliberately. This was a flat list of fourteen top-level items,
   * which no longer fitted the header: seven of them — Settings and Admin
   * among them — sat outside the visible area with no scrollbar to hint at
   * it, so they simply looked missing.
   *
   * Four dashboards and four analytics pages are the natural groups, and
   * both sets already share a permission, so grouping costs nothing in
   * access control and takes the bar from fourteen items to eight.
   */
  allMenus: any[] = [
    {
      label: 'Dashboards', icon: 'dashnew',
      children: [
        { label: 'Live Dashboard', path: '/dashboard', permission: 'page:dashboard' },
        { label: 'Factory Overall', path: '/factory', permission: 'page:analytics-factory' },
        { label: 'Maintenance', path: '/maintenance-dashboard', permission: 'page:analytics-maintenance' },
        { label: 'Preventive', path: '/preventive-maintenance', permission: 'page:analytics-preventive' },
        { label: 'Periodic', path: '/periodic-maintenance', permission: 'page:analytics-periodic' },
        { label: 'Alarms', path: '/alarm-report', permission: 'page:analytics-alarms' },
        { label: 'Downtime', path: '/downtime-analysis', permission: 'page:analytics-downtime' },
        { label: 'Operators', path: '/operator-performance', permission: 'page:analytics-operators' },
        { label: 'OEE', path: '/oee-dashboard', permission: 'page:analytics-oee' },
        { label: 'Energy', path: '/energy-dashboard', permission: 'page:analytics-energy' }
      ]
    },
    {
      label: 'Analytics', icon: 'donutnew',
      children: [
        { label: 'OEE', path: '/oee-reports', permission: 'page:oee-reports' },
        { label: 'Reports', path: '/reports', permission: 'page:reports' },
        { label: 'Charts', path: '/charts', permission: 'page:charts' },
        { label: 'Quality', path: '/quality', permission: 'page:quality' },
        { label: 'Maintenance Report', path: '/maintenance-report', permission: 'page:maintenance-report' }
      ]
    },
    { label: 'Alarms', path: '/alarms', icon: 'alerts', permission: 'page:alarms' },
    { label: 'Downtime', path: '/downtime', icon: 'downtime', permission: 'page:downtime' },
    { label: 'Maintenance', path: '/maintenance', icon: 'maintenance', permission: 'page:maintenance' },
    {
      label: 'Settings', icon: 'gearnew',
      children: [
        { label: 'Machines', path: '/machines', permission: 'page:machines' },
        { label: 'Program Transfer', path: '/programs', permission: 'page:programs' },
        { label: 'Component', path: '/component', permission: 'page:component' },
        { label: 'Job', path: '/job', permission: 'page:job' },
        { label: 'Lines', path: '/lines', permission: 'page:lines' },
        { label: 'Shifts', path: '/shifts', permission: 'page:shifts' },
        { label: 'Operators', path: '/operators', permission: 'page:operators' },
        { label: '2FA Security', path: '/security/2fa' }
      ]
    },
    { label: 'Admin', path: '/admin/users', icon: 'shield', adminOnly: true } 
  ];

  menus: any[] = [];

  constructor(
    private router: Router,
    private auth: AuthService,
    public  theme: ThemeService,
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
    this.userRole    = user.user_type === 'snt_super' ? 'S&T Super Admin'
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

    // A refresh that brought different grants: rebuild, so a page the company
    // just lost stops appearing in the bar without a reload.
    this.grantsSub = this.auth.grantsChanged$.subscribe(() => {
      this.buildMenus();
      this.touch();
    });
  }

  ngOnDestroy() { this.grantsSub?.unsubscribe(); }

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
            !child.permission || this.auth.hasPermission(child.permission)
          );
          return filteredChildren.length > 0 ? { ...menu, children: filteredChildren } : null;
        }

        return !menu.permission || this.auth.hasPermission(menu.permission) ? menu : null;
      })
      .filter(m => m !== null);
  }

  toggleUserMenu() { this.showUserMenu = !this.showUserMenu; this.touch(); }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  toggleMenu(label: string) { this.openMenu = this.openMenu === label ? null : label; this.touch(); }
  closeMenu() { this.openMenu = null; this.touch(); }

  navigate(menu: any) {
    this.router.navigate([menu.path]);
    this.closeMenu();
  }

  isActive(path: string) { return this.router.url.startsWith(path); }
  isChildActive(children: any[]) { return children?.some(c => this.router.url.startsWith(c.path)); }

  /* State and persistence now live in ThemeService — before this, isDark
     was a plain component field, always initialised to false, with nothing
     reading or writing localStorage. It survived route changes (the header
     sits outside <router-outlet>) but not a reload or a new tab: dark mode
     never actually stuck. */
  toggleTheme() { this.theme.toggle(); }

  isMobileMenuOpen = false;
  toggleMobileMenu() { this.isMobileMenuOpen = !this.isMobileMenuOpen; this.touch(); }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const before = `${this.openMenu}|${this.showUserMenu}`;
    if (!target.closest('nav'))             this.openMenu     = null;
    if (!target.closest('.user-menu-wrap')) this.showUserMenu = false;
    // only repaint when something actually closed
    if (before !== `${this.openMenu}|${this.showUserMenu}`) this.touch();
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.openMenu = null; this.showUserMenu = false; this.touch(); }
}
