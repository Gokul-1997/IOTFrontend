import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LicensingService } from '../../core/services/licensing.service';
import { Subject, takeUntil } from 'rxjs';


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
    <nav class="ui-tabs ui-tabs-center" [class.super-admin-nav]="auth.isSntSuper()" aria-label="Admin sections">

  <a *ngIf="auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/companies"
     routerLinkActive="is-active"
     #companies="routerLinkActive"
     [attr.aria-current]="companies.isActive ? 'page' : null">
    <span class="ui-tab-icon material-icons" aria-hidden="true">business</span>
    Companies
  </a>

  <a *ngIf="auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/plans"
     routerLinkActive="is-active"
     #plans="routerLinkActive"
     [attr.aria-current]="plans.isActive ? 'page' : null">
    <span class="ui-tab-icon material-icons" aria-hidden="true">workspace_premium</span>
    Plans
  </a>

  <a class="ui-tab"
     routerLink="/admin/users"
     routerLinkActive="is-active"
     #users="routerLinkActive"
     [attr.aria-current]="users.isActive ? 'page' : null">
     <span class="ui-tab-icon material-icons" aria-hidden="true">groups</span>
    {{ auth.isSntSuper() ? 'Company Admins' : 'Users' }}
  </a>

  <a *ngIf="!auth.isSntSuper()"
     class="ui-tab"
     routerLink="/admin/roles"
     routerLinkActive="is-active"
     #roles="routerLinkActive"
     [attr.aria-current]="roles.isActive ? 'page' : null">
     <span class="ui-tab-icon material-icons" aria-hidden="true">settings</span>
    Roles &amp; Permissions
  </a>

  <a *ngIf="licensingAvailable" class="ui-tab" routerLink="/admin/licensing" routerLinkActive="is-active">Deployment licenses</a>
</nav>
  `
})
export class AdminTabsComponent implements OnInit, OnDestroy {
  licensingAvailable = false;
  private destroy = new Subject<void>();
  constructor(public auth: AuthService, private licensing: LicensingService, private cdr: ChangeDetectorRef) {}
  ngOnInit() { this.licensing.available().pipe(takeUntil(this.destroy)).subscribe(value => { this.licensingAvailable = value; this.cdr.markForCheck(); }); }
  ngOnDestroy() { this.destroy.next(); this.destroy.complete(); }
}
