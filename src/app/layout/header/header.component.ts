import { Component, HostListener, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { NAV_MENUS, NavItem, pathMatches } from '../nav-menu';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/notification-bell/notification-bell.component';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule, NotificationBellComponent],
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

  /** The menu, shared with the breadcrumb (layout/nav-menu.ts). */
  allMenus: NavItem[] = NAV_MENUS.map(m => ({ ...m, children: m.children?.map(c => ({ ...c })) }));

  menus: NavItem[] = [];
  /** The phone menu in the desktop bar's order: each group under its own
   *  heading, the single pages (Alarms, Downtime, Maintenance) together as
   *  "Shop floor" where the first of them sits, Admin with the account. */
  phoneSections: { label: string; icon: string; items: NavItem[] }[] = [];
  adminItem: NavItem | null = null;
  private routeSub?: Subscription;

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

    // a new page closes any open menu
    this.routeSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      if (this.isMobileMenuOpen || this.openMenu || this.showUserMenu) {
        this.isMobileMenuOpen = false; this.openMenu = null; this.showUserMenu = false; this.touch();
      }
    });

    // A refresh that brought different grants: rebuild, so a page the company
    // just lost stops appearing in the bar without a reload.
    this.grantsSub = this.auth.grantsChanged$.subscribe(() => {
      this.buildMenus();
      this.touch();
    });
  }

  ngOnDestroy() { this.grantsSub?.unsubscribe(); this.routeSub?.unsubscribe(); }

  buildMenus() {
    // SNT_SUPER only sees Admin pages — no dashboard/reports/master
    if (this.isSntSuper) {
      this.menus = this.allMenus.filter(m => m.adminOnly);
      this.splitForPhone();
      return;
    }

    this.menus = this.allMenus
      .map(menu => {
        if (menu.adminOnly) return this.isAdmin ? menu : null;

        if (menu.children) {
          const filteredChildren = menu.children.filter((child: NavItem) =>
            this.allowed(child.permission)
          );
          return filteredChildren.length > 0 ? { ...menu, children: filteredChildren } : null;
        }

        return this.allowed(menu.permission) ? menu : null;
      })
      .filter(m => m !== null) as NavItem[];
    this.splitForPhone();
  }

  private splitForPhone() {
    const sections: { label: string; icon: string; items: NavItem[] }[] = [];
    let shopFloor: { label: string; icon: string; items: NavItem[] } | null = null;
    this.adminItem = null;
    for (const m of this.menus) {
      if (m.adminOnly) { this.adminItem = m; continue; }
      if (m.children) { sections.push({ label: m.label, icon: m.icon || 'apps', items: m.children }); continue; }
      if (!shopFloor) { shopFloor = { label: 'Shop floor', icon: 'precision_manufacturing', items: [] }; sections.push(shopFloor); }
      shopFloor.items.push(m);
    }
    this.phoneSections = sections;
  }

  toggleUserMenu() { this.showUserMenu = !this.showUserMenu; this.touch(); }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  /** No permission, one, or any of several (a page more than one grant opens). */
  private allowed(p: string | string[] | undefined): boolean {
    if (!p) return true;
    return Array.isArray(p) ? p.some(k => this.auth.hasPermission(k)) : this.auth.hasPermission(p);
  }

  toggleMenu(label: string) { this.openMenu = this.openMenu === label ? null : label; this.touch(); }
  closeMenu() { this.openMenu = null; this.touch(); }

  /* Whole path segments: startsWith() lit "Maintenance" on the Maintenance
     Dashboard and the Maintenance Report as well. */
  isActive(path: string | undefined) { return pathMatches(this.router.url, path); }
  isChildActive(children: NavItem[] | undefined) { return !!children?.some(c => pathMatches(this.router.url, c.path)); }

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
  onEsc() { this.openMenu = null; this.showUserMenu = false; this.isMobileMenuOpen = false; this.touch(); }
}
