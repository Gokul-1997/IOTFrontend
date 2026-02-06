import { Component } from '@angular/core';
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

  showMenu(label: string) { }
  hideMenu() { }
  isDark = false;

  // 🔹 MENU CONFIG (label + route)
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


  constructor(private router: Router) { }

  // 🔹 NAVIGATION
  navigate(menu: any) {
    this.router.navigate([menu.path]);
  }

  // 🔹 ACTIVE MENU CHECK
  isActive(path: string): boolean {
    return this.router.url.startsWith(path);
  }

  // 🌙 THEME
  toggleTheme() {
    this.isDark = !this.isDark;
    document.documentElement.classList.toggle('dark', this.isDark);
  }


  isChildActive(children: any[]): boolean {
    return children?.some(c => this.router.url.startsWith(c.path));
  }
}
