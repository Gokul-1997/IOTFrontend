import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';


/**
 * The Admin section's tabs, shared by its four pages (it was copied into
 * each). S&T sees Companies, Plans and Company Admins; a company admin sees
 * Users and Roles & Permissions.
 */
@Component({
  selector: 'app-admin-tabs',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- page links, not tabs: each opens its own page, the current one has aria-current -->
    <nav class="ui-tabs ui-tabs-center" aria-label="Admin sections">

  <a *ngIf="auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/companies"
     routerLinkActive="is-active"
     #companies="routerLinkActive"
     [attr.aria-current]="companies.isActive ? 'page' : null">
    Companies
  </a>

  <a *ngIf="auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/plans"
     routerLinkActive="is-active"
     #plans="routerLinkActive"
     [attr.aria-current]="plans.isActive ? 'page' : null">
    Plans
  </a>

  <a class="ui-tab"
     routerLink="/admin/users"
     routerLinkActive="is-active"
     #users="routerLinkActive"
     [attr.aria-current]="users.isActive ? 'page' : null">
    {{ auth.isSntSuper() ? 'Company Admins' : 'Users' }}
  </a>

  <a *ngIf="!auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/roles"
     routerLinkActive="is-active"
     #roles="routerLinkActive"
     [attr.aria-current]="roles.isActive ? 'page' : null">
    Roles &amp; Permissions
  </a>

</nav>
  `
})
export class AdminTabsComponent {
  constructor(public auth: AuthService) {}
}
