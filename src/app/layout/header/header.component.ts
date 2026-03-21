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

  menus = [
    { label: 'Dashboard', path: '/dashboard', icon: 'gauge' },
    { label: 'OEE', path: '/oee-reports', icon: 'oee' },
    { label: 'Reports', path: '/reports', icon: 'reports' },
    { label: 'Charts', path: '/charts', icon: 'chart' },
    { label: 'Quality', path: '/quality', icon: 'quality' },
    {
      label: 'Master', icon: 'settings',
      children: [
        { label: 'Machines', path: '/machines' },
        { label: 'Component', path: '/component' },
        { label: 'Job', path: '/job' },
        { label: 'Shifts', path: '/shifts' },
        { label: 'Operators', path: '/operators' }
      ]
    }
  ];

  constructor(private router: Router, private auth: AuthService) { }

  ngOnInit() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      this.userName  = user.name  || user.username || 'Admin';
      this.userEmail = user.email || '';
    } catch { }
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
