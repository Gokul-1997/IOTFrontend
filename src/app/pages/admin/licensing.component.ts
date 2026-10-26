import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, map } from 'rxjs';
import { AdminTabsComponent } from './admin-tabs.component';
import { DeploymentLicense, LicenseForm, LicensingService, licenseFormError } from '../../core/services/licensing.service';
import { CompanyService } from '../../core/services/company.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, AdminTabsComponent],
  template: `
  <section class="p-4 md:p-6 space-y-5">
    <app-admin-tabs />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h1 class="text-2xl font-bold text-slate-900 dark:text-white">Deployment licenses</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">Owner controls for cloud and on-premise subscriptions.</p></div>
      <button class="ui-btn ui-btn-primary" (click)="create()" [disabled]="busy">Create license</button>
    </div>
    <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
      Start with 10 machines and a confirmed subscription expiry. The effective allowance also respects the company's plan.
      On-premise installations require internet checks. Expiry blocks application access and program transfers; it does not stop CNC machines or delete recorded data.
      Payment confirmation is manual in this phase.
    </div>
    <p *ngIf="error" role="alert" class="text-red-600 dark:text-red-300">{{error}} <button class="underline" (click)="load()">Retry</button></p>
    <p *ngIf="busy" role="status">Loading…</p>
    <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <table class="w-full text-sm text-left"><thead class="bg-slate-50 dark:bg-slate-800"><tr>
        <th class="p-3">Company / deployment</th><th class="p-3">Allowance</th><th class="p-3">Expiry</th><th class="p-3">Status</th><th class="p-3">Actions</th>
      </tr></thead><tbody><tr *ngFor="let row of rows" class="border-t border-slate-100 dark:border-slate-800">
        <td class="p-3"><strong>{{row.company_name || row.company_id}}</strong><br>{{row.name}} · {{row.deployment_mode === 'cloud' ? 'Cloud' : 'On-premise'}}
          <small *ngIf="row.last_seen_at" class="block text-slate-500">Last check {{row.last_seen_at | date:'short'}}</small></td>
        <td class="p-3">{{row.max_machines}} machines</td><td class="p-3">{{row.expires_at | date:'medium'}}</td>
        <td class="p-3">{{expired(row) ? 'Expired' : row.status}}</td>
        <td class="p-3"><div class="flex flex-wrap gap-3">
          <button class="underline" (click)="edit(row)" [disabled]="busy || row.status === 'revoked'">Edit / renew</button>
          <button class="underline" (click)="status(row, row.status === 'active' ? 'suspended' : 'active')" [disabled]="busy || row.status === 'revoked'">{{row.status === 'active' ? 'Suspend' : 'Resume'}}</button>
          <button class="underline text-red-600 dark:text-red-300" (click)="status(row,'revoked')" [disabled]="busy || row.status === 'revoked'">Revoke</button>
          <button *ngIf="row.deployment_mode === 'on_prem'" class="underline" (click)="rotate(row)" [disabled]="busy || row.status === 'revoked'">Rotate credential</button>
          <button class="underline" (click)="history(row)">History</button>
        </div></td></tr>
        <tr *ngIf="!rows.length && !busy"><td class="p-6 text-center" colspan="5">No companies are enrolled. Creating a license enables enforcement for that company.</td></tr>
      </tbody></table>
    </div>
    <div *ngIf="showForm" class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <h2 class="text-lg font-bold mb-4">{{editing ? 'Edit / renew license' : 'Create deployment license'}}</h2>
      <form (ngSubmit)="save()" class="grid sm:grid-cols-2 gap-4">
        <label *ngIf="!editing">Company<select class="ui-input block w-full" name="company" [(ngModel)]="form.company_id" required><option [ngValue]="0">Select company</option><option *ngFor="let c of companies" [ngValue]="c.id">{{c.company_name}}</option></select></label>
        <label *ngIf="!editing">Deployment<select class="ui-input block w-full" name="mode" [(ngModel)]="form.deployment_mode"><option value="cloud">Cloud</option><option value="on_prem">On-premise (internet required)</option></select></label>
        <label *ngIf="!editing">Name<input class="ui-input block w-full" name="name" [(ngModel)]="form.name" maxlength="120" required></label>
        <label>Active machine allowance<input class="ui-input block w-full" type="number" name="machines" [(ngModel)]="form.max_machines" min="1" max="100000" step="1" required></label>
        <label>Expiry (your local time)<input class="ui-input block w-full" type="datetime-local" name="expiry" [(ngModel)]="form.expires_at" required></label>
        <label>Payment reference<input class="ui-input block w-full" name="payment" [(ngModel)]="form.payment_reference" maxlength="200"></label>
        <label class="sm:col-span-2">Owner note<textarea class="ui-input block w-full" name="note" [(ngModel)]="form.note" maxlength="1000"></textarea></label>
        <p *ngIf="formError" role="alert" class="sm:col-span-2 text-red-600 dark:text-red-300">{{formError}}</p>
        <div class="sm:col-span-2 flex gap-3"><button class="ui-btn ui-btn-primary" type="submit" [disabled]="busy">Save license</button><button class="ui-btn ui-btn-secondary" type="button" (click)="showForm=false">Cancel</button></div>
      </form>
    </div>
    <div *ngIf="credential" role="dialog" aria-modal="true" aria-label="One-time installation credential" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div class="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 p-6 space-y-4">
        <h2 class="text-xl font-bold">Save this installation credential</h2><p>Shown once. Store it in the installation's protected credential file. It is not saved in this browser.</p>
        <label class="block">Installation ID<input class="ui-input block w-full" [value]="installationId" readonly></label>
        <label class="block">Credential<input class="ui-input block w-full" type="password" [value]="credential" readonly aria-label="Installation credential"></label>
        <div class="flex gap-3"><button class="ui-btn ui-btn-primary" (click)="copyCredential()">Copy credential</button><button class="ui-btn ui-btn-secondary" (click)="clearCredential()">I saved it</button></div>
      </div>
    </div>
    <div *ngIf="events" class="rounded-xl border border-slate-200 dark:border-slate-700 p-5">
      <div class="flex justify-between"><h2 class="font-bold">License history</h2><button class="underline" (click)="events=null">Close</button></div>
      <p *ngIf="!events.length">No recorded changes.</p><p *ngFor="let e of events" class="py-2 border-b border-slate-100 dark:border-slate-800">{{e.created_at | date:'medium'}} · {{e.action}} · Owner {{e.actor_id}}<span *ngIf="e.payment_reference"> · {{e.payment_reference}}</span><br>{{e.note}}</p>
    </div>
  </section>`
})
export class LicensingComponent implements OnInit, OnDestroy {
  rows: DeploymentLicense[] = []; companies: any[] = []; busy = false; error = ''; formError = '';
  showForm = false; editing: DeploymentLicense | null = null; credential = ''; installationId = '';
  events: { id: number; actor_id: number; action: string; created_at: string; note?: string; payment_reference?: string }[] | null = null;
  form = this.blank(); private destroy = new Subject<void>(); private clearTimer?: ReturnType<typeof setTimeout>;
  constructor(private licenses: LicensingService, private companyService: CompanyService, private toast: ToastService, private confirm: ConfirmService, private cdr: ChangeDetectorRef) {}
  ngOnInit() { this.licenses.available().pipe(takeUntil(this.destroy)).subscribe(allowed => { if (allowed) { this.load(); this.companyService.getCompanies().pipe(takeUntil(this.destroy)).subscribe({next: rows => { this.companies=rows; this.cdr.markForCheck(); },error: () => this.toast.error('Could not load companies')}); } }); }
  ngOnDestroy() { this.destroy.next(); this.destroy.complete(); this.clearCredential(); }
  blank(): LicenseForm { return { company_id: 0, name: '', deployment_mode: 'on_prem', max_machines: 10, expires_at: '', note: '', payment_reference: '' }; }
  expired(row: DeploymentLicense) { return row.status === 'active' && Date.parse(row.expires_at) <= Date.now(); }
  load() { this.busy=true; this.error=''; this.licenses.list().pipe(takeUntil(this.destroy)).subscribe({next: rows => {this.rows=rows;this.busy=false;this.cdr.markForCheck();},error: () => {this.busy=false;this.error='Licenses could not be loaded.';this.cdr.markForCheck();}}); }
  create() { this.editing=null; this.form=this.blank(); this.formError=''; this.showForm=true; }
  edit(row: DeploymentLicense) { this.editing=row; const d=new Date(row.expires_at); const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); this.form={company_id:row.company_id,name:row.name,deployment_mode:row.deployment_mode,max_machines:row.max_machines,expires_at:local,note:row.note||'',payment_reference:row.payment_reference||''};this.formError='';this.showForm=true; }
  save() {
    this.formError=licenseFormError(this.form)||''; if(this.formError||this.busy) return;
    const body={...this.form,company_id:Number(this.form.company_id),max_machines:Number(this.form.max_machines),expires_at:new Date(this.form.expires_at).toISOString()}; this.busy=true;
    const request=this.editing ? this.licenses.update(this.editing.id,{max_machines:body.max_machines,expires_at:body.expires_at,note:body.note,payment_reference:body.payment_reference}).pipe(map(license=>({license,activation_token:'',installation_id:license.installation_id}))) : this.licenses.create(body);
    request.pipe(takeUntil(this.destroy)).subscribe({next: result => {this.showForm=false;if(result.activation_token && result.license.deployment_mode==='on_prem') this.showCredential(result.activation_token,result.installation_id);this.toast.success('License saved');this.load();},error: e => {this.busy=false;this.formError=e.error?.message||'Could not save the license.';this.cdr.markForCheck();}});
  }
  async status(row: DeploymentLicense, status: DeploymentLicense['status']) {
    if(this.busy) return; const ok=await this.confirm.ask({title:`${status === 'active' ? 'Resume' : status === 'revoked' ? 'Revoke' : 'Suspend'} ${row.name}?`,message:status==='revoked'?'Revocation cannot be undone. Application access stops at the next license check. Recorded data is retained.':'This changes application access at the next license check. Resuming also requires an unexpired subscription and active company.',confirmText:'Confirm',tone:status==='active'?'primary':'danger'}); if(!ok) return;
    this.busy=true; this.licenses.update(row.id,{status}).pipe(takeUntil(this.destroy)).subscribe({next:()=>this.load(),error:e=>{this.busy=false;this.toast.error(e.error?.message||'Could not change license status');this.cdr.markForCheck();}});
  }
  async rotate(row: DeploymentLicense) {
    if(this.busy || !await this.confirm.ask({title:'Replace installation credential?',message:'The previous credential stops renewing. Install the new one and restart the on-premise API before its current lease expires.',confirmText:'Replace credential',tone:'danger'})) return;
    this.busy=true;this.licenses.rotate(row.id).pipe(takeUntil(this.destroy)).subscribe({next:value=>{this.busy=false;this.showCredential(value.activation_token,value.installation_id);this.cdr.markForCheck();},error:()=>{this.busy=false;this.toast.error('Could not replace the credential');this.cdr.markForCheck();}});
  }
  history(row:DeploymentLicense) {this.licenses.history(row.id).pipe(takeUntil(this.destroy)).subscribe({next:value=>{this.events=value;this.cdr.markForCheck();},error:()=>this.toast.error('Could not load license history')});}
  showCredential(value:string,id:string) {this.clearCredential();this.credential=value;this.installationId=id;this.clearTimer=setTimeout(()=>{this.clearCredential();this.cdr.markForCheck();},300000);}
  clearCredential() {clearTimeout(this.clearTimer);this.credential='';this.installationId='';}
  async copyCredential() {try {await navigator.clipboard.writeText(this.credential);this.toast.success('Credential copied. Store it securely.');}catch{this.toast.error('Clipboard access failed. Ask your administrator to allow it.');}}
}
