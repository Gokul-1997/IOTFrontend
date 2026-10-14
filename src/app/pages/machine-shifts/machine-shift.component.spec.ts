import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { MachineShiftComponent } from './machine-shift.component';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

test('changing machines cancels the old configuration and saving waits for the selected machine', () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), {
    provide: AuthService, useValue: { sessionVersion: 0, sessionChanged$: new Subject(), grantsChanged$: new Subject() }
  }] }).overrideComponent(MachineShiftComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(MachineShiftComponent);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(environment.apiUrl + '/master/machines').flush({ data: [] });
  http.expectOne(environment.apiUrl + '/shifts').flush([]);
  const component = fixture.componentInstance;
  component.form.patchValue({ machine_id: '7' }); component.loadConfig();
  const old = http.expectOne(environment.apiUrl + '/machine-shifts/7');
  component.form.patchValue({ machine_id: '8' }); component.loadConfig();
  expect(old.cancelled).toBe(true);
  component.save(); http.expectNone(environment.apiUrl + '/machine-shifts');
  http.expectOne(environment.apiUrl + '/machine-shifts/8').flush([{ shift_id: 3 }]);
  component.save();
  const save = http.expectOne(environment.apiUrl + '/machine-shifts');
  expect(save.request.body).toEqual({ machine_id: 8, shift_ids: [3] });
  save.flush({});
  component.form.patchValue({ machine_id: '' }); component.loadConfig();
  expect(component.selectedShifts).toEqual([]);
  component.save(); http.expectNone(environment.apiUrl + '/machine-shifts');
  http.verify(); fixture.destroy(); TestBed.resetTestingModule();
});
