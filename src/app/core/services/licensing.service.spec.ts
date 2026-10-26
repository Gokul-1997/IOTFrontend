import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { LicensingService, licenseFormError } from './licensing.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

let http: HttpTestingController; let service: LicensingService; let owner: boolean;
beforeEach(() => {
  owner = true; environment.phase3Licensing = false;
  TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:AuthService,useValue:{isSntSuper:()=>owner}}]});
  http=TestBed.inject(HttpTestingController); service=TestBed.inject(LicensingService);
});
afterEach(()=>{http.verify();environment.phase3Licensing=false;TestBed.resetTestingModule();});
test('default build hides licensing without any HTTP request even for the owner',async()=>{expect(await firstValueFrom(service.available())).toBe(false);http.expectNone(`${environment.apiUrl}/licensing/capabilities`);});
test('company administrator cannot query owner capabilities in an enabled build',async()=>{environment.phase3Licensing=true;owner=false;expect(await firstValueFrom(service.available())).toBe(false);http.expectNone(`${environment.apiUrl}/licensing/capabilities`);});
test.each([{}, {enabled:true}, {enabled:false,authority:true}, {enabled:true,authority:false}])('requires both enabled and authority from server %j',async body=>{
  environment.phase3Licensing=true;const result=firstValueFrom(service.available());http.expectOne(`${environment.apiUrl}/licensing/capabilities`).flush(body);expect(await result).toBe(false);
});
test('owner plus enabled server can open the future screen',async()=>{environment.phase3Licensing=true;const result=firstValueFrom(service.available());http.expectOne(`${environment.apiUrl}/licensing/capabilities`).flush({enabled:true,authority:true});expect(await result).toBe(true);});
test('disabled/unavailable backend stays hidden',async()=>{environment.phase3Licensing=true;const result=firstValueFrom(service.available());http.expectOne(`${environment.apiUrl}/licensing/capabilities`).flush({}, {status:404,statusText:'Not found'});expect(await result).toBe(false);});
test('losing owner access while capabilities are in flight cannot expose the page',async()=>{environment.phase3Licensing=true;const result=firstValueFrom(service.available());owner=false;http.expectOne(`${environment.apiUrl}/licensing/capabilities`).flush({enabled:true,authority:true});expect(await result).toBe(false);});
const valid=()=>({company_id:4,name:'Factory',deployment_mode:'on_prem' as const,max_machines:10,expires_at:new Date(Date.now()+86400000).toISOString(),note:'',payment_reference:''});
test('ten-machine future subscription is valid',()=>expect(licenseFormError(valid())).toBeNull());
test.each([0,-1,1.5,100001])('rejects invalid allowance %s',max_machines=>expect(licenseFormError({...valid(),max_machines})).toBeTruthy());
test('expired or malformed dates, missing company/name and overlong notes are refused',()=>{
  for(const patch of [{expires_at:'bad'},{expires_at:new Date(0).toISOString()},{company_id:0},{name:' '},{note:'a'.repeat(1001)}])expect(licenseFormError({...valid(),...patch})).toBeTruthy();
});
