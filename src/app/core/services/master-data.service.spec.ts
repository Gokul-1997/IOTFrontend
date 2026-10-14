import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { MasterDataService } from './master-data.service';
import { AuthService } from './auth.service';
import { MasterDataInterceptor } from '../interceptors/master-data.interceptor';
import { ChartsService } from '../../pages/charts/charts.service';
import { FactoryService } from '../../pages/factory/factory.service';
import { MaintenanceDashboardService } from '../../pages/maintenance-dashboard/maintenance-dashboard.service';
import { OeeDashboardService } from '../../pages/oee-dashboard/oee-dashboard.service';
import { environment } from '../../../environments/environment';
import { HttpClient } from '@angular/common/http';

let http: HttpTestingController;
let master: MasterDataService;
const auth = { sessionVersion: 0, sessionChanged$: new Subject<string>(), grantsChanged$: new Subject<void>() };
const url = environment.apiUrl + '/charts/meta';
beforeEach(() => {
  auth.sessionVersion = 0;
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(withInterceptors([MasterDataInterceptor])), provideHttpClientTesting(),
    { provide: AuthService, useValue: auth }
  ] });
  http = TestBed.inject(HttpTestingController);
  master = TestBed.inject(MasterDataService);
});
afterEach(() => { http.verify(); TestBed.resetTestingModule(); vi.useRealTimers(); });

test('four different screens share one in-flight metadata request, then reuse it', () => {
  const seen: any[] = [];
  for (const service of [TestBed.inject(ChartsService), TestBed.inject(FactoryService),
    TestBed.inject(MaintenanceDashboardService), TestBed.inject(OeeDashboardService)]) {
    service.getMeta().subscribe(r => seen.push(r));
  }
  const requests = http.match(url);
  expect(requests).toHaveLength(1);
  requests[0].flush({ data: { machines: [{ id: 7 }], shifts: [] } });
  expect(seen).toHaveLength(4);
  TestBed.inject(FactoryService).getMeta().subscribe(r => seen.push(r));
  http.expectNone(url);
  expect(seen).toHaveLength(5);
});

test('expiration is measured from the successful response and causes one fresh read', () => {
  vi.useFakeTimers();
  master.get('charts').subscribe();
  http.expectOne(url).flush({ data: 1 });
  vi.advanceTimersByTime(299_999);
  master.get('charts').subscribe(); http.expectNone(url);
  vi.advanceTimersByTime(1);
  master.get('charts').subscribe(); master.get('charts').subscribe();
  http.expectOne(url).flush({ data: 2 });
});

test('sign-out cancels old requests and a held observable resolves the new tenant', () => {
  const held = master.get('charts'), old = vi.fn(), current = vi.fn();
  held.subscribe(old);
  const pending = http.expectOne(url);
  auth.sessionVersion++;
  auth.sessionChanged$.next('signed-out');
  expect(pending.cancelled).toBe(true);
  held.subscribe(current);
  http.expectOne(url).flush({ data: { machines: [{ id: 900 }] } });
  expect(old).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledWith({ data: { machines: [{ id: 900 }] } });
});

test('changed permissions invalidate cached plant and machine scope', () => {
  master.get('charts').subscribe(); http.expectOne(url).flush({ data: 'old' });
  auth.grantsChanged$.next();
  master.get('charts').subscribe(); http.expectOne(url).flush({ data: 'new' });
});

test('failed and navigation-cancelled requests are retried', () => {
  master.get('charts').subscribe({ error: () => {} });
  http.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
  const subscription = master.get('charts').subscribe();
  const pending = http.expectOne(url);
  subscription.unsubscribe();
  expect(pending.cancelled).toBe(true);
  master.get('charts').subscribe(); http.expectOne(url).flush({ data: [] });
});

test('successful master edits invalidate; failed edits and unrelated writes preserve the cache', () => {
  const client = TestBed.inject(HttpClient);
  master.get('charts').subscribe(); http.expectOne(url).flush({ data: 'cached' });
  client.put(environment.apiUrl + '/machines/7', {}).subscribe({ error: () => {} });
  http.expectOne(environment.apiUrl + '/machines/7').flush({}, { status: 400, statusText: 'Bad request' });
  client.post(environment.apiUrl + '/notifications/mark-all-read', {}).subscribe();
  http.expectOne(environment.apiUrl + '/notifications/mark-all-read').flush({});
  master.get('charts').subscribe(); http.expectNone(url);
  client.patch(environment.apiUrl + '/shifts/1/status', {}).subscribe();
  http.expectOne(environment.apiUrl + '/shifts/1/status').flush({});
  master.get('charts').subscribe(); http.expectOne(url).flush({ data: 'new' });
});
