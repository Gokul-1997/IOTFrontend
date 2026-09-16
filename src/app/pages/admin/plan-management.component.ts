import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CompanyService } from '../../core/services/company.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

/*
 * Plans — the catalogue a company is assigned from.
 *
 * Until now plans could only be created by inserting rows by hand: the API
 * had POST /plans and PUT /plans/:id, and company.service.ts had
 * createPlan/updatePlan, but no screen called them. "Assign Plan" could
 * therefore only ever offer the three rows that were seeded.
 *
 * Deactivating a plan matters as much as creating one: company.assignPlan
 * refuses an inactive plan ("The Gold plan is no longer available"), so this
 * is how a plan is retired without touching the companies already on it.
 */
@Component({
  selector: 'app-plan-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './plan-management.component.html'
})
export class PlanManagementComponent implements OnInit {
  plans: any[] = [];
  companies: any[] = [];
  loading = false;

  showModal = false;
  editId: number | null = null;
  form = this.blankForm();

  constructor(
    private companyService: CompanyService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.loadPlans();
    this.loadCompanies();
  }

  blankForm() {
    return {
      plan_code: '', plan_name: '', tier: 1, description: '',
      max_users: 10, max_plants: 1, max_machines: 20, is_active: true
    };
  }

  loadPlans() {
    this.loading = true;
    this.cdr.detectChanges();
    this.companyService.getPlans().subscribe({
      next: res => { this.plans = res || []; this.loading = false; this.cdr.detectChanges(); },
      error: () => { this.loading = false; this.cdr.detectChanges(); this.toast.error('Failed to load plans'); }
    });
  }

  /* Only to show how many companies are on each plan. A plan in use should
     not be retired without the admin knowing who it affects. */
  loadCompanies() {
    this.companyService.getCompanies().subscribe({
      next: res => { this.companies = res || []; this.cdr.detectChanges(); },
      error: () => { /* the count is decoration; the screen works without it */ }
    });
  }

  companiesOn(planId: number): number {
    return this.companies.filter(c => c.plan_id === planId).length;
  }

  openCreate() {
    this.editId = null;
    this.form = this.blankForm();
    this.showModal = true;
    this.cdr.detectChanges();
  }

  openEdit(plan: any) {
    this.editId = plan.id;
    this.form = {
      // plan_code is the stable key other rows point at, so it is not editable
      plan_code: plan.plan_code,
      plan_name: plan.plan_name,
      tier: plan.tier ?? 1,
      description: plan.description || '',
      max_users: plan.max_users,
      max_plants: plan.max_plants,
      max_machines: plan.max_machines,
      is_active: plan.is_active !== false
    };
    this.showModal = true;
    this.cdr.detectChanges();
  }

  close() {
    this.showModal = false;
    this.editId = null;
    this.cdr.detectChanges();
  }

  /** Whole numbers above zero; a limit of 0 would lock a company out of its own data. */
  private invalidLimit(value: any): boolean {
    const n = Number(value);
    return !Number.isInteger(n) || n < 1;
  }

  save() {
    if (!this.form.plan_name.trim()) { this.toast.error('Plan name is required'); return; }
    if (!this.editId && !this.form.plan_code.trim()) { this.toast.error('Plan code is required'); return; }

    for (const [label, value] of [
      ['Max users', this.form.max_users],
      ['Max plants', this.form.max_plants],
      ['Max machines', this.form.max_machines]
    ] as [string, any][]) {
      if (this.invalidLimit(value)) { this.toast.error(`${label} must be a whole number of 1 or more`); return; }
    }

    this.loading = true;
    this.cdr.detectChanges();

    const payload: any = {
      plan_name: this.form.plan_name.trim(),
      description: this.form.description?.trim() || null,
      max_users: Number(this.form.max_users),
      max_plants: Number(this.form.max_plants),
      max_machines: Number(this.form.max_machines)
    };
    if (this.editId) {
      payload.is_active = this.form.is_active;
    } else {
      payload.plan_code = this.form.plan_code.trim().toLowerCase();
      payload.tier = Number(this.form.tier) || 1;
    }

    const req = this.editId
      ? this.companyService.updatePlan(this.editId, payload)
      : this.companyService.createPlan(payload);

    req.subscribe({
      next: () => {
        this.toast.success(this.editId ? 'Plan updated' : 'Plan created');
        this.close();
        this.loadPlans();
      },
      error: err => {
        this.loading = false;
        this.cdr.detectChanges();
        this.toast.error(err.error?.message || 'Failed to save the plan');
      }
    });
  }

  toggleActive(plan: any) {
    const inUse = this.companiesOn(plan.id);
    if (plan.is_active && inUse > 0) {
      /* Retiring a plan does not move anyone off it; their existing
         assignment keeps working. It only stops new assignments. */
      const ok = confirm(
        `${plan.plan_name} is assigned to ${inUse} company(ies).\n\n` +
        `Retiring it does not change them — it only stops the plan being assigned again. Continue?`
      );
      if (!ok) return;
    }
    this.companyService.updatePlan(plan.id, { is_active: !plan.is_active }).subscribe({
      next: () => {
        this.toast.success(plan.is_active ? 'Plan retired' : 'Plan made available');
        this.loadPlans();
      },
      error: err => this.toast.error(err.error?.message || 'Failed to update the plan')
    });
  }

  tierBadgeClass(tier: number): string {
    switch (Number(tier)) {
      case 3:  return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
      case 2:  return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
      default: return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
    }
  }
}
