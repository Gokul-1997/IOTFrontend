import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminService } from './admin.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-role-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './role-management.component.html',
  changeDetection: ChangeDetectionStrategy.Default
})
export class RoleManagementComponent implements OnInit {
  roles: any[] = [];
  permissionModules: any[] = [];  // [{module, label, group, permissions: [{id, permission_key, action}]}]
  permissionGroups: string[] = [];
  loading = false;
  showCreateModal = false;
  showPagesModal = false;
  selectedRole: any = null;

  createForm = { role_name: '' };
  selectedPermIds: Set<number> = new Set();

  /* Copy a role into a new one the company owns */
  showCopyModal = false;
  copySource: any = null;
  copyName = '';
  copying = false;

  constructor(
    private adminService: AdminService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadRoles();
    this.loadPermissions();
  }

  /* The roles model: S&T creates the company and its admin and sets what it
     can use (Manage Access); the company starts with its own copy of the
     default roles, and its admin manages every one of them. Only a company
     admin reaches this page (companyRolesGuard). */

  /** Any company role can be copied; Company Admin's access is Manage Access, not pages. */
  canCopy(role: any): boolean {
    return !role.is_system;
  }

  isCompanyAdminRole(role: any): boolean { return role.is_system && role.role_name === 'COMPANY_ADMIN'; }

  loadRoles() {
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.getRoles().subscribe({
      next: res => {
        this.roles = [...res];
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to load roles');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadPermissions() {
    this.adminService.getPagePermissions().subscribe({
      next: res => {
        this.permissionModules = [...res];
        this.permissionGroups = [...new Set(res.map((m: any) => m.group))] as string[];
        this.cdr.detectChanges();
      },
      error: () => this.toastService.error('Failed to load permissions')
    });
  }

  getModulesByGroup(group: string): any[] {
    return this.permissionModules.filter(m => m.group === group);
  }

  // ── Create Role ──
  openCreateModal() {
    this.createForm = { role_name: '' };
    this.showCreateModal = true;
    this.cdr.detectChanges();
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.cdr.detectChanges();
  }

  createRole() {
    if (!this.createForm.role_name.trim()) {
      this.toastService.error('Role name is required');
      return;
    }
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.createRole({ role_name: this.createForm.role_name.trim() }).subscribe({
      next: () => {
        this.toastService.success('Role created. Now choose what it can open.');
        this.closeCreateModal();
        this.loadRoles();
      },
      error: err => {
        this.toastService.error(err.error?.message || 'Failed to create role');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Permission Assignment Modal ──
  openPagesModal(role: any) {
    // The template disables this for system roles; guard the method too, so a
    // stale click or a direct call cannot open an editor whose Save the API
    // will refuse.
    if (role?.is_system) return;
    this.selectedRole = role;
    this.selectedPermIds = new Set(
      (role.permissions || [])
        .filter((p: any) => p.permission_key?.startsWith('page:'))
        .map((p: any) => p.id)
    );
    this.showPagesModal = true;
    this.cdr.detectChanges();
  }

  closePagesModal() {
    this.showPagesModal = false;
    this.selectedRole = null;
    this.selectedPermIds = new Set();
    this.cdr.detectChanges();
  }

  isPermSelected(permId: number): boolean {
    return this.selectedPermIds.has(permId);
  }

  togglePerm(permId: number) {
    const s = new Set(this.selectedPermIds);
    s.has(permId) ? s.delete(permId) : s.add(permId);
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  toggleModule(mod: any) {
    const s = new Set(this.selectedPermIds);
    const allSelected = mod.permissions.every((p: any) => s.has(p.id));
    mod.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id));
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  isModuleAllSelected(mod: any): boolean {
    return mod.permissions.length > 0 && mod.permissions.every((p: any) => this.selectedPermIds.has(p.id));
  }

  isModulePartial(mod: any): boolean {
    const count = mod.permissions.filter((p: any) => this.selectedPermIds.has(p.id)).length;
    return count > 0 && count < mod.permissions.length;
  }

  toggleGroup(group: string) {
    const mods = this.getModulesByGroup(group);
    const s = new Set(this.selectedPermIds);
    const allSelected = mods.every(m => m.permissions.every((p: any) => s.has(p.id)));
    mods.forEach(m => m.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id)));
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  isGroupAllSelected(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    return mods.every(m => m.permissions.every((p: any) => this.selectedPermIds.has(p.id)));
  }

  isGroupPartial(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    const allPerms = mods.flatMap(m => m.permissions);
    const count = allPerms.filter((p: any) => this.selectedPermIds.has(p.id)).length;
    return count > 0 && count < allPerms.length;
  }

  savePageAccess() {
    if (!this.selectedRole) return;
    // Pages only. The API keys those pages need are worked out by the server.
    const pageIds = Array.from(this.selectedPermIds);
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.assignPermissionsToRole(this.selectedRole.id, pageIds).subscribe({
      next: () => {
        this.toastService.success('Permissions updated successfully');
        this.closePagesModal();
        this.loadRoles();
      },
      error: err => {
        this.toastService.error(err.error?.message || 'Failed to update permissions');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Copy ──
  openCopyModal(role: any) {
    if (!this.canCopy(role)) return;
    this.copySource = role;
    this.copyName = `${role.role_name} COPY`;
    this.showCopyModal = true;
    this.cdr.detectChanges();
  }

  closeCopyModal() {
    this.showCopyModal = false;
    this.copySource = null;
    this.copyName = '';
    this.cdr.detectChanges();
  }

  copyRole() {
    const name = this.copyName.trim();
    if (!this.copySource || !name) {
      this.toastService.error('Give the new role a name');
      return;
    }
    this.copying = true;
    this.cdr.detectChanges();
    this.adminService.copyRole(this.copySource.id, { role_name: name }).subscribe({
      next: (res: any) => {
        this.copying = false;
        // say what was left out, and why, rather than letting it look complete
        const skipped = res?.skipped || 0;
        this.toastService.success(
          `"${res?.role?.role_name || name}" created from ${res?.from || this.copySource.role_name}` +
          (skipped ? ` — ${skipped} permission${skipped === 1 ? '' : 's'} left out because your plan does not include ${skipped === 1 ? 'it' : 'them'}` : '')
        );
        this.closeCopyModal();
        this.loadRoles();
      },
      error: err => {
        this.copying = false;
        this.toastService.error(err.error?.message || 'Could not copy the role');
        this.cdr.detectChanges();
      }
    });
  }

  // ── Delete ──
  deleteRole(role: any) {
    if (role.is_system) return;
    if (!confirm(`Delete role "${role.role_name}"? This cannot be undone.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.deleteRole(role.id).subscribe({
      next: () => {
        this.toastService.success('Role deleted');
        this.loadRoles();
      },
      error: err => {
        // e.g. "assigned to 3 active users — move them first"
        this.toastService.error(err.error?.message || 'Failed to delete role');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Helpers ──
  getPageNames(role: any): string {
    const pages = (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:'));
    if (!pages.length) return '';
    // Group by module and show unique module names
    const moduleSet = new Set<string>();
    pages.forEach((p: any) => moduleSet.add(this.moduleOf(p.permission_key)));
    // the names people see in the menu, not keys like "analytics-oee"
    return Array.from(moduleSet)
      .map(m => this.permissionModules.find(x => x.module === m)?.label || m.charAt(0).toUpperCase() + m.slice(1))
      .join(', ');
  }

  getPageCount(role: any): number {
    // Count unique modules (not individual actions)
    const modules = new Set(
      (role.permissions || [])
        .filter((p: any) => p.permission_key?.startsWith('page:'))
        .map((p: any) => this.moduleOf(p.permission_key))
    );
    return modules.size;
  }

  /** page:dashboard:live:view → "dashboard:live" (the module, whatever its depth). */
  private moduleOf(key: string): string {
    return key.split(':').slice(1, -1).join(':');
  }

  getActionCount(role: any): number {
    return (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:')).length;
  }
}
