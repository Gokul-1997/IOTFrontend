import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProgramsComponent } from './programs.component';
import { PtGateway, PtMachine } from '../../core/services/program.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { environment } from '../../../environments/environment';

/*
 * Program Transfer, kept simple: a machine, its line of programs (the
 * company's one gateway sends them one at a time), files, a backup. The
 * template is left out; this is the logic.
 */
const api = environment.apiUrl + '/programs';
const gw = (o: Partial<PtGateway> = {}): PtGateway => ({ token_prefix: 'mxg_abcdefgh', token_created_at: '2026-10-20T05:00:00Z',
                                                         last_seen_at: new Date().toISOString(), online: true, ...o });
const machine = (o: Partial<PtMachine> = {}): PtMachine => ({
  id: 7, machine_serial_no: 'VMC-1',
  next: { id: 40, program_name: 'O1001.nc', size_bytes: 24, created_at: '2026-10-21T05:00:00Z' }, waiting: 1,
  last_report: null, last_backup: null, backup_request: null, backup_failure: null, ...o
});
const page = { page: 1, limit: 20, total: 0, totalPages: 1 };

let http: HttpTestingController;
let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
let ask: ReturnType<typeof vi.fn>;

function create(machines: PtMachine[] = [machine(), machine({ id: 8, machine_serial_no: 'VMC-2' })], gateway: PtGateway | null = gw()) {
  toast = { success: vi.fn(), error: vi.fn() };
  ask = vi.fn(() => Promise.resolve(true));
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
    { provide: AuthService, useValue: { hasAction: () => true } },
    { provide: ToastService, useValue: toast },
    { provide: ConfirmService, useValue: { ask } }
  ] }).overrideComponent(ProgramsComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(ProgramsComponent);
  fixture.detectChanges();
  http = TestBed.inject(HttpTestingController);
  http.expectOne(`${api}/machines`).flush({ data: machines, gateway });
  return fixture;
}
const files = (machineId = 7) => http.expectOne(r => r.url === `${api}/files` && r.params.get('machine_id') === String(machineId));
const file = (o: Record<string, unknown> = {}) => ({ id: 30, machine_id: 7, program_name: 'O0999.nc', kind: 'NEW' as const, size_bytes: 10, sha256: 'a',
  created_at: '', uploaded_by_name: null, queue_position: null, delivery_status: null, delivery_message: null, delivered_at: null, ...o });

afterEach(() => { TestBed.resetTestingModule(); });

test('opens on the first machine and lists its files; changing machine lists the other one', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  expect(c.selectedMachineId).toBe(7);
  expect(c.gateway?.token_prefix).toBe('mxg_abcdefgh');
  const first = files(7);
  expect(first.request.params.get('page')).toBe('1');
  first.flush({ data: [], pagination: page });

  c.selectedMachineId = 8; c.changeMachine();
  files(8).flush({ data: [], pagination: page });
  c.setFilter('backups');
  expect(files(8).request.params.get('kind')).toBe('backups');
  http.verify();
  fixture.destroy();
});

test('upload sends the machine and the file; its place in the line is announced and the lists reload', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.openUpload();
  c.upload();
  expect(c.uploadError).toBe('Choose the program file.');

  const program = new File(['%\nO2002\nM30\n%'], 'O2002.nc', { type: 'text/plain' });
  c.onFileSelected({ target: { files: [program] } } as any);
  c.upload();
  const post = http.expectOne(`${api}/files`);
  expect(post.request.method).toBe('POST');
  const body = post.request.body as FormData;
  expect(body.get('machine_id')).toBe('7');
  expect((body.get('file') as File).name).toBe('O2002.nc');
  post.flush({ data: { id: 41, program_name: 'O2002.nc', queue_position: 2 } });
  expect(c.showUpload).toBe(false);
  expect(toast.success).toHaveBeenCalledWith('O2002.nc is 2nd in line for VMC-1');
  files().flush({ data: [], pagination: page });
  http.expectOne(`${api}/machines`).flush({ data: [machine({ waiting: 2 })], gateway: gw() });
  files().flush({ data: [], pagination: page });                     // the line grew: the files are listed again

  // the only one waiting: it goes next
  c.openUpload();
  c.onFileSelected({ target: { files: [program] } } as any);
  c.upload();
  http.expectOne(`${api}/files`).flush({ data: { id: 42, program_name: 'O2003.nc', queue_position: 1 } });
  expect(toast.success).toHaveBeenCalledWith('O2003.nc is next to send to VMC-1');
  files().flush({ data: [], pagination: page });
  http.expectOne(`${api}/machines`).flush({ data: [machine({ waiting: 3 })], gateway: gw() });
  files().flush({ data: [], pagination: page });
  http.verify();
  fixture.destroy();
});

test('a file over the limit or empty is refused before anything is sent', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.openUpload();
  c.onFileSelected({ target: { files: [new File([], 'O1.nc')] } } as any);
  expect(c.uploadError).toBe('This file is empty.');
  c.upload();
  http.expectNone(`${api}/files`);
  fixture.destroy();
});

test('Backup now asks once; a backup arriving later is announced and listed', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.requestBackup();
  const post = http.expectOne(`${api}/machines/7/backup`);
  post.flush({ data: { id: 9, requested_at: '2026-10-21T05:10:00Z', created: true } });
  expect(c.selectedMachine?.backup_request).toEqual({ id: 9, requested_at: '2026-10-21T05:10:00Z' });

  c.loadMachines(true);   // the page's own refresh
  http.expectOne(`${api}/machines`).flush({ data: [machine({ last_backup: { id: 43, program_name: 'O1001.nc', created_at: '2026-10-21T05:11:00Z' } })], gateway: gw() });
  expect(toast.success).toHaveBeenCalledWith('Backup received from VMC-1');
  files().flush({ data: [], pagination: page });
  http.verify();
  fixture.destroy();
});

test('deleting asks first — a waiting upload is said to leave the line; no is no request', async () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  ask.mockResolvedValueOnce(false);
  await c.deleteFile(file({ queue_position: 2 }));
  expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Delete O0999.nc?',
    message: "It is taken out of VMC-1's line and never sent to the machine." }));
  http.expectNone(`${api}/files/30`);

  await c.deleteFile(file({ delivery_status: 'DONE' }));
  expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'This upload of VMC-1 is removed from the server.' }));
  http.expectOne(r => r.method === 'DELETE' && r.url === `${api}/files/30`).flush({ data: { deleted: true } });
  expect(toast.success).toHaveBeenCalledWith('O0999.nc deleted');
  fixture.destroy();
});

test("the company's one gateway: online, offline with when, or not set up yet (S&T makes its token)", () => {
  const fixture = create(undefined, null);
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  expect(c.gatewayState()).toBe('none');
  expect(c.gatewayLabel()).toBe('No gateway yet — S&T sets it up');
  expect(c.gatewayLabel(gw())).toBe('Gateway online');
  const tenMinutes = new Date(Date.now() - 10 * 60000).toISOString();
  expect(c.gatewayLabel(gw({ last_seen_at: tenMinutes, online: false }))).toBe('Gateway offline · last seen 10 min ago');
  expect(c.gatewayLabel(gw({ last_seen_at: null, online: false }))).toBe('Gateway has not connected yet');
  expect((c as any).createToken).toBeUndefined();      // no token is made on the company's page
  fixture.destroy();
});

test('what the gateway reports reaches the page: a program taken, the next one refused, a backup that could not be read', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.requestBackup();
  http.expectOne(`${api}/machines/7/backup`).flush({ data: { id: 9, requested_at: '2026-10-21T05:10:00Z', created: true } });

  // O1001 written; the line is empty now
  c.loadMachines(true);
  http.expectOne(`${api}/machines`).flush({ data: [machine({ next: null, waiting: 0, backup_request: { id: 9, requested_at: '' },
    last_report: { id: 40, program_name: 'O1001.nc', delivery_status: 'DONE', delivery_message: null, delivered_at: '2026-10-21T05:12:00Z' } })], gateway: gw() });
  expect(toast.success).toHaveBeenCalledWith('O1001.nc is on VMC-1');
  files().flush({ data: [], pagination: page });

  // the next upload refused, and the backup could not be read
  c.loadMachines(true);
  http.expectOne(`${api}/machines`).flush({ data: [machine({ next: null, waiting: 0,
    last_report: { id: 41, program_name: 'O1002.nc', delivery_status: 'FAILED', delivery_message: 'CNC memory full', delivered_at: '2026-10-21T05:13:00Z' },
    backup_failure: { message: 'CNC not reachable', at: '2026-10-21T05:13:00Z' } })], gateway: gw() });
  expect(toast.error).toHaveBeenCalledWith('VMC-1 could not use O1002.nc: CNC memory full');
  expect(toast.error).toHaveBeenCalledWith('VMC-1 could not send a backup: CNC not reachable');
  files().flush({ data: [], pagination: page });

  // nothing new: no toast, no reload
  c.loadMachines(true);
  http.expectOne(`${api}/machines`).flush({ data: [machine({ next: null, waiting: 0,
    last_report: { id: 41, program_name: 'O1002.nc', delivery_status: 'FAILED', delivery_message: 'CNC memory full', delivered_at: '2026-10-21T05:13:00Z' },
    backup_failure: { message: 'CNC not reachable', at: '2026-10-21T05:13:00Z' } })], gateway: gw() });
  http.verify();
  expect(toast.error).toHaveBeenCalledTimes(2);
  fixture.destroy();
});

test("each upload's state: its place in line, or what the gateway reported", () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  expect(c.deliveryLabel({ delivery_status: null, queue_position: 1 })).toBe('Next to send');
  expect(c.deliveryLabel({ delivery_status: null, queue_position: 2 })).toBe('Waiting · 2nd in line');
  expect(c.deliveryLabel({ delivery_status: null, queue_position: 3 })).toBe('Waiting · 3rd in line');
  expect(c.deliveryLabel({ delivery_status: null, queue_position: 11 })).toBe('Waiting · 11th in line');
  expect(c.deliveryLabel({ delivery_status: null, queue_position: 22 })).toBe('Waiting · 22nd in line');
  expect(c.deliveryLabel({ delivery_status: 'DONE', queue_position: null })).toBe('On the machine');
  expect(c.deliveryLabel({ delivery_status: 'FAILED', queue_position: null })).toBe('Refused by machine');
  expect(c.deliveryLabel({ delivery_status: 'SKIPPED', queue_position: null })).toBe('Not sent');
  expect(c.deliveryClass({ delivery_status: null, queue_position: 1 })).toBe('mexa-badge-info');
  expect(c.deliveryClass({ delivery_status: null, queue_position: 2 })).toBe('mexa-badge-neutral');
  fixture.destroy();
});
