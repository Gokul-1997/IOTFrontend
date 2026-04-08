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
  pagePermissions: any[] = [];
  pageGroups: string[] = [];
  loading = false;
  showCreateModal = false;
  showPagesModal = false;
  selectedRole: any = null;
  seeding = false;

  createForm = { role_name: '' };
  selectedPageIds: Set<number> = new Set();

  constructor(
    private adminService: AdminService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadRoles();
    this.loadPagePermissions();
  }

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

  loadPagePermissions() {
    this.adminService.getPagePermissions().subscribe({
      next: res => {
        this.pagePermissions = [...res];
        this.pageGroups = [...new Set(res.map((p: any) => p.group))] as string[];
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to load page permissions');
      }
    });
  }

  seedPages() {
    this.seeding = true;
    this.cdr.detectChanges();
    this.adminService.seedPagePermissions().subscribe({
      next: () => {
        this.toastService.success('Page permissions seeded successfully');
        this.seeding = false;
        this.loadPagePermissions();
      },
      error: () => {
        this.toastService.error('Failed to seed page permissions');
        this.seeding = false;
        this.cdr.detectChanges();
      }
    });
  }

  getPagesByGroup(group: string): any[] {
    return this.pagePermissions.filter(p => p.group === group);
  }

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
    this.adminService.createRole(this.createForm).subscribe({
      next: () => {
        this.toastService.success('Role created successfully');
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

  openPagesModal(role: any) {
    this.selectedRole = role;
    this.selectedPageIds = new Set(
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
    this.selectedPageIds = new Set();
    this.cdr.detectChanges();
  }

  togglePage(pageId: number) {
    const s = new Set(this.selectedPageIds);
    s.has(pageId) ? s.delete(pageId) : s.add(pageId);
    this.selectedPageIds = s;
    this.cdr.detectChanges();
  }

  isPageSelected(pageId: number): boolean {
    return this.selectedPageIds.has(pageId);
  }

  toggleGroup(group: string) {
    const pages = this.getPagesByGroup(group);
    const s = new Set(this.selectedPageIds);
    const allSelected = pages.every(p => s.has(p.id));
    allSelected ? pages.forEach(p => s.delete(p.id)) : pages.forEach(p => s.add(p.id));
    this.selectedPageIds = s;
    this.cdr.detectChanges();
  }

  isGroupAllSelected(group: string): boolean {
    const pages = this.getPagesByGroup(group);
    return pages.length > 0 && pages.every(p => this.selectedPageIds.has(p.id));
  }

  isGroupPartialSelected(group: string): boolean {
    const pages = this.getPagesByGroup(group);
    const count = pages.filter(p => this.selectedPageIds.has(p.id)).length;
    return count > 0 && count < pages.length;
  }

  savePageAccess() {
    if (!this.selectedRole) return;
    const nonPagePermIds = (this.selectedRole.permissions || [])
      .filter((p: any) => !p.permission_key?.startsWith('page:'))
      .map((p: any) => p.id);
    const allPermIds = [...nonPagePermIds, ...Array.from(this.selectedPageIds)];
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.assignPermissionsToRole(this.selectedRole.id, allPermIds).subscribe({
      next: () => {
        this.toastService.success('Page access updated successfully');
        this.closePagesModal();
        this.loadRoles();
      },
      error: () => {
        this.toastService.error('Failed to update page access');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteRole(role: any) {
    if (!confirm(`Delete role "${role.role_name}"? This cannot be undone.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.deleteRole(role.id).subscribe({
      next: () => {
        this.toastService.success('Role deleted');
        this.loadRoles();
      },
      error: () => {
        this.toastService.error('Failed to delete role');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  getPageNames(role: any): string {
    const pages = (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:'));
    if (!pages.length) return 'No page access';
    return pages.map((p: any) => {
      const key = p.permission_key.replace('page:', '');
      return key.charAt(0).toUpperCase() + key.slice(1);
    }).join(', ');
  }

  getPageCount(role: any): number {
    return (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:')).length;
  }
}
