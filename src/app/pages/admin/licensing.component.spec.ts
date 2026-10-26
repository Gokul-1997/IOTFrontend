import { of } from 'rxjs';
import { vi } from 'vitest';
import { ChangeDetectorRef } from '@angular/core';
import { LicensingComponent } from './licensing.component';
import { LicensingService } from '../../core/services/licensing.service';
import { CompanyService } from '../../core/services/company.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';

function fixture() {
  const licenses={available:vi.fn(()=>of(true)),list:vi.fn(()=>of([])),create:vi.fn((_body:unknown)=>of({license:{deployment_mode:'on_prem'},activation_token:'test-only-credential',installation_id:'fixture-installation'})),update:vi.fn((_id:string,_body:unknown)=>of({})),rotate:vi.fn(),history:vi.fn()};
  const company={getCompanies:vi.fn(()=>of([]))};const toast={success:vi.fn(),error:vi.fn()};
  const confirm={ask:vi.fn(async()=>true)};const cdr={markForCheck:vi.fn()};
  const component=new LicensingComponent(licenses as unknown as LicensingService,company as unknown as CompanyService,toast as unknown as ToastService,confirm as unknown as ConfirmService,cdr as unknown as ChangeDetectorRef);
  return{component,licenses,company};
}
test('disabled capabilities prevent the page from loading tenant or license data',()=>{const f=fixture();f.licenses.available.mockReturnValue(of(false));f.component.ngOnInit();expect(f.licenses.list).not.toHaveBeenCalled();expect(f.company.getCompanies).not.toHaveBeenCalled();f.component.ngOnDestroy();});
test('creation starts at ten machines and converts local expiry to explicit ISO',()=>{
  const f=fixture();f.component.create();expect(f.component.form.max_machines).toBe(10);
  f.component.form={...f.component.form,company_id:4,name:'Factory',expires_at:new Date(Date.now()+86400000).toISOString().slice(0,16)};
  f.component.save();expect(f.licenses.create).toHaveBeenCalledWith(expect.objectContaining({company_id:4,max_machines:10,expires_at:expect.stringMatching(/Z$/)}));
  expect(f.component.credential).toBe('test-only-credential');f.component.ngOnDestroy();expect(f.component.credential).toBe('');
});
test('invalid allowance or expired subscription never reaches the API',()=>{const f=fixture();f.component.form={...f.component.form,company_id:4,name:'Factory',max_machines:0,expires_at:new Date(0).toISOString()};f.component.save();expect(f.licenses.create).not.toHaveBeenCalled();expect(f.component.formError).toBeTruthy();f.component.ngOnDestroy();});
test('renewal changes expiry/capacity without changing company or installation identity',()=>{
  const f=fixture();f.licenses.update.mockReturnValue(of({deployment_mode:'cloud'}));
  f.component.edit({id:'fixture',company_id:4,name:'Factory',deployment_mode:'cloud',installation_id:'fixed',max_machines:10,expires_at:new Date(Date.now()+86400000).toISOString(),status:'active',revision:1});
  f.component.form.max_machines=12;f.component.save();const body=f.licenses.update.mock.calls[0]?.[1];
  expect(body).toMatchObject({max_machines:12});expect(body).not.toHaveProperty('company_id');expect(body).not.toHaveProperty('installation_id');expect(f.component.credential).toBe('');f.component.ngOnDestroy();
});
