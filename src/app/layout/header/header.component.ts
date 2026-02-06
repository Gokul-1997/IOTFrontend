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

  isDark = false;

  // 🔹 MENU CONFIG (label + route)
  menus = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'OEE', path: '/oee/hourly' },
    { label: 'Reports', path: '/reports' },
    { label: 'Master', path: '/machines' }
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
}
