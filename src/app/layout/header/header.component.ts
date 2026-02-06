import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule],
  templateUrl: './header.component.html',
})
export class HeaderComponent {

  menus = ['Dashboard', 'OEE', 'Reports', 'Charts', 'Quality', 'Master'];
  activeMenu = 'Dashboard';
  isDark = false;

  setActive(menu: string) {
    this.activeMenu = menu;
  }

  toggleTheme() {
    this.isDark = !this.isDark;
    document.documentElement.classList.toggle('dark', this.isDark);
  }
}
