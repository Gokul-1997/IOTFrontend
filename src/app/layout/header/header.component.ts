import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon';
import { AuthService } from '../../core/services/auth.service';


@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './header.component.html',
})
export class HeaderComponent implements OnInit {

  openMenu: string | null = null;
  isDark = false;
  showUserMenu = false;
  userName = 'Admin';
  userEmail = '';
  isAdmin = false;
  userPermissions: string[] = [];

  // All menus with permission keys for filtering
  allMenus: any[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'gauge', permission: 'page:dashboard' },
    { label: 'OEE', path: '/oee-reports', icon: 'oee', permission: 'page:oee-reports' },
    { label: 'Reports', path: '/reports', icon: 'reports', permission: 'page:reports' },
    { label: 'Charts', path: '/charts', icon: 'chart', permission: 'page:charts' },
    { label: 'Quality', path: '/quality', icon: 'quality', permission: 'page:quality' },
    {
      label: 'Master', icon: 'settings',
      children: [
        { label: 'Machines', path: '/machines', permission: 'page:machines' },
        { label: 'Component', path: '/component', permission: 'page:component' },
        { label: 'Job', path: '/job', permission: 'page:job' },
        { label: 'Shifts', path: '/shifts', permission: 'page:shifts' },
        { label: 'Operators', path: '/operators', permission: 'page:operators' }
      ]
    },
    { label: 'Admin', path: '/admin/users', icon: 'shield', adminOnly: true }
  ];

  menus: any[] = [];

  constructor(private router: Router, private auth: AuthService) { }

  ngOnInit() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      this.userName  = user.name  || user.username || 'Admin';
      this.userEmail = user.email || '';
      this.isAdmin = user.roles && Array.isArray(user.roles) && user.roles.includes('ADMIN');
      this.userPermissions = user.permissions || [];
    } catch { }

    this.buildMenus();
  }

  /** Filter menus based on user permissions. ADMIN sees everything. */
  buildMenus() {
    this.menus = this.allMenus
      .map(menu => {
        // Admin-only item
        if (menu.adminOnly) {
          return this.isAdmin ? menu : null;
        }

        // Dropdown with children
        if (menu.children) {
          const filteredChildren = menu.children.filter((child: any) =>
            this.isAdmin || this.hasPermission(child.permission)
          );
          return filteredChildren.length > 0
            ? { ...menu, children: filteredChildren }
            : null;
        }

        // Normal menu item
        if (this.isAdmin || this.hasPermission(menu.permission)) {
          return menu;
        }

        return null;
      })
      .filter(m => m !== null);
  }

  hasPermission(permission: string): boolean {
    if (!permission) return true;
    return this.userPermissions.includes(permission);
  }

  toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
  }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  toggleMenu(label: string) {
    this.openMenu = this.openMenu === label ? null : label;
  }

  closeMenu() {
    this.openMenu = null;
  }

  navigate(menu: any) {
    this.router.navigate([menu.path]);
    this.closeMenu();
  }

  isActive(path: string) {
    return this.router.url.startsWith(path);
  }

  isChildActive(children: any[]) {
    return children?.some(c => this.router.url.startsWith(c.path));
  }

  toggleTheme() {
    this.isDark = !this.isDark;
    document.documentElement.classList.toggle('dark', this.isDark);
  }

  // Responsive Menu

  isMobileMenuOpen = false;
  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  // 🔒 CLOSE ON OUTSIDE CLICK
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('nav'))      this.openMenu    = null;
    if (!target.closest('.user-menu-wrap')) this.showUserMenu = false;
  }

  // ⌨ ESC KEY CLOSE
  @HostListener('document:keydown.escape')
  onEsc() {
    this.openMenu = null;
  }
}
