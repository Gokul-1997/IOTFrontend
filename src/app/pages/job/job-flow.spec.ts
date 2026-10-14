import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { JobCreateModalComponent } from './job-create-modal.component';
import { JobListComponent } from './job-list.component';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.useRealTimers(); });

test('job components cannot come from an old machine and the default start uses local time', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
    .overrideComponent(JobCreateModalComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(JobCreateModalComponent); fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController), component = fixture.componentInstance;
  expect(component.form.job_start).toBe('2026-10-13T15:30');
  http.expectOne(environment.apiUrl + '/jobs/available-machines').flush({ data: [] });
  component.form.machine_id = 7; component.onMachineChange();
  const old = http.expectOne(r => r.url.startsWith(environment.apiUrl + '/components'));
  component.form.machine_id = 8; component.onMachineChange();
  expect(old.cancelled).toBe(true);
  component.form.component_id = 70; component.save(); http.expectNone(environment.apiUrl + '/jobs/start');
  http.expectOne(r => r.url.startsWith(environment.apiUrl + '/components')).flush({ data: [{ id: 80 }] });
  component.save(); http.expectNone(environment.apiUrl + '/jobs/start');
  component.form.component_id = 80; component.save();
  const save = http.expectOne(environment.apiUrl + '/jobs/start');
  expect(save.request.body.machine_id).toBe(8); expect(save.request.body.component_id).toBe(80);
  const closed = vi.fn(); component.close.subscribe(closed); save.flush({});
  expect(closed).toHaveBeenCalledWith(true);
  http.verify(); fixture.destroy();
});

test('history is fetched only when visible and uses bounded server pages; cancel does not reload', () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
    { provide: AuthService, useValue: {} }] })
    .overrideComponent(JobListComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(JobListComponent); fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController), component = fixture.componentInstance;
  http.expectOne(environment.apiUrl + '/jobs/current').flush({ data: [] });
  http.expectNone(r => r.url.endsWith('/jobs/history'));
  component.closeModal(false); http.expectNone(environment.apiUrl + '/jobs/current');
  component.setTab('history');
  const first = http.expectOne(r => r.url.endsWith('/jobs/history'));
  expect(first.request.params.get('page')).toBe('1'); expect(first.request.params.get('limit')).toBe('10');
  first.flush({ data: [{ id: 1 }], total: 2500, page: 1, limit: 10, totalPages: 250 });
  expect(component.historyTotal).toBe(2500);
  component.setTab('active'); component.setTab('history'); http.expectNone(r => r.url.endsWith('/jobs/history'));
  component.changeHistoryPage({ pageIndex: 1, pageSize: 10, length: 2500 });
  const second = http.expectOne(r => r.url.endsWith('/jobs/history'));
  expect(second.request.params.get('page')).toBe('2');
  second.flush({ data: [{ id: 11 }], total: 2500, page: 2, limit: 10, totalPages: 250 });
  expect(component.historySource.data).toEqual([{ id: 11 }]);
  http.verify(); fixture.destroy();
});
