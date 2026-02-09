import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule],
  templateUrl: './header.component.html',
})
export class HeaderComponent {

  openMenu: string | null = null;
  isDark = false;

  menus = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'OEE', path: '/oee-reports' },
    { label: 'Reports', path: '/reports' },
    { label: 'Charts', path: '/charts' },
    { label: 'Quality', path: '/quality' },
    {
      label: 'Master',
      children: [
        { label: 'Machines', path: '/machines' },
        { label: 'Shifts', path: '/shifts' },
        { label: 'Operators', path: '/operators' },
        { label: 'Plants', path: '/plants' }
      ]
    }
  ];

  constructor(private router: Router) {}

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

  // 🔒 CLOSE ON OUTSIDE CLICK
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('nav')) {
      this.openMenu = null;
    }
  }

  // ⌨ ESC KEY CLOSE
  @HostListener('document:keydown.escape')
  onEsc() {
    this.openMenu = null;
  }
}
