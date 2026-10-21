import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProgramsComponent } from './programs.component';
import { PtMachine } from '../../core/services/program.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { environment } from '../../../environments/environment';

/*
 * Program Transfer, kept simple: a machine, upload its program, download
 * files, ask for a backup. The template is left out; this is the logic.
 */
const api = environment.apiUrl + '/programs';
const machine = (o: Partial<PtMachine> = {}): PtMachine => ({
  id: 7, machine_serial_no: 'VMC-1', gateway: { token_prefix: 'mxd_abcdefgh', token_created_at: '2026-10-20T05:00:00Z', last_seen_at: new Date().toISOString(), online: true },
  program: { id: 40, program_name: 'O1001.nc', size_bytes: 24, created_at: '2026-10-21T05:00:00Z',
             delivery_status: null, delivery_message: null, delivered_at: null },
  last_backup: null, backup_request: null, backup_failure: null, ...o
});
const page = { page: 1, limit: 20, total: 0, totalPages: 1 };

let http: HttpTestingController;
let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
let ask: ReturnType<typeof vi.fn>;

function create(machines: PtMachine[] = [machine(), machine({ id: 8, machine_serial_no: 'VMC-2' })]) {
  toast = { success: vi.fn(), error: vi.fn() };
  ask = vi.fn(() => Promise.resolve(true));
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
    { provide: AuthService, useValue: { hasAction: () => true } },
    { provide: ToastService, useValue: toast },
    { provide: ConfirmService, useValue: { ask } }
  ] }).overrideComponent(ProgramsComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(ProgramsComponent);
  fixture.detectChanges();
  http = TestBed.inject(HttpTestingController);
  http.expectOne(`${api}/machines`).flush({ data: machines });
  return fixture;
}
const files = (machineId = 7) => http.expectOne(r => r.url === `${api}/files` && r.params.get('machine_id') === String(machineId));

afterEach(() => { TestBed.resetTestingModule(); });

test('opens on the first machine and lists its files; changing machine lists the other one', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  expect(c.selectedMachineId).toBe(7);
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

test('upload sends the machine and the file; the new program is announced and the lists reload', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.openUpload();
  c.upload();
  expect(c.uploadError).toBe('Choose the program file.');

  const file = new File(['%\nO2002\nM30\n%'], 'O2002.nc', { type: 'text/plain' });
  c.onFileSelected({ target: { files: [file] } } as any);
  c.upload();
  const post = http.expectOne(`${api}/files`);
  expect(post.request.method).toBe('POST');
  const body = post.request.body as FormData;
  expect(body.get('machine_id')).toBe('7');
  expect((body.get('file') as File).name).toBe('O2002.nc');
  post.flush({ data: { id: 41, program_name: 'O2002.nc' } });
  expect(c.showUpload).toBe(false);
  expect(toast.success).toHaveBeenCalledWith("O2002.nc is now VMC-1's program");
  files().flush({ data: [], pagination: page });
  http.expectOne(`${api}/machines`).flush({ data: [machine()] });
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
  http.expectOne(`${api}/machines`).flush({ data: [machine({ last_backup: { id: 43, program_name: 'O1001.nc', created_at: '2026-10-21T05:11:00Z' } })] });
  expect(toast.success).toHaveBeenCalledWith('Backup received from VMC-1');
  files().flush({ data: [], pagination: page });
  http.verify();
  fixture.destroy();
});

test('deleting asks first; no is no request', async () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  const f = { id: 30, machine_id: 7, program_name: 'O0999.nc', kind: 'NEW' as const, size_bytes: 10, sha256: 'a', created_at: '',
              uploaded_by_name: null, is_current: false, delivery_status: null, delivery_message: null, delivered_at: null };
  ask.mockResolvedValueOnce(false);
  await c.deleteFile(f);
  http.expectNone(`${api}/files/30`);
  await c.deleteFile(f);
  http.expectOne(r => r.method === 'DELETE' && r.url === `${api}/files/30`).flush({ data: { deleted: true } });
  expect(toast.success).toHaveBeenCalledWith('O0999.nc deleted');
  fixture.destroy();
});

test('a new gateway token is kept in the dialog; replacing one asks first', async () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.openToken(c.selectedMachine!);
  ask.mockResolvedValueOnce(false);
  await c.createToken();
  http.expectNone(`${api}/machines/7/device-token`);
  await c.createToken();
  http.expectOne(`${api}/machines/7/device-token`).flush({ data: { token: 'mxd_' + 'x'.repeat(43), token_prefix: 'mxd_xxxxxxxx', created_at: '' } });
  expect(c.tokenDialog?.token).toBe('mxd_' + 'x'.repeat(43));
  fixture.destroy();
});

test('gateway label says online, offline with when, or no token', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  expect(c.gatewayLabel(machine())).toBe('Gateway online');
  expect(c.gatewayLabel(machine({ gateway: null }))).toBe('No gateway token yet');
  const tenMinutes = new Date(Date.now() - 10 * 60000).toISOString();
  expect(c.gatewayLabel(machine({ gateway: { token_prefix: 'mxd_a', token_created_at: '', last_seen_at: tenMinutes, online: false } })))
    .toBe('Gateway offline · last seen 10 min ago');
  fixture.destroy();
});

test('what the gateway reports reaches the page: the program refused, a backup that could not be read', () => {
  const fixture = create();
  const c = fixture.componentInstance;
  files().flush({ data: [], pagination: page });
  c.requestBackup();
  http.expectOne(`${api}/machines/7/backup`).flush({ data: { id: 9, requested_at: '2026-10-21T05:10:00Z', created: true } });

  c.loadMachines(true);
  const refused = machine({ program: { id: 40, program_name: 'O1001.nc', size_bytes: 24, created_at: '2026-10-21T05:00:00Z',
                                      delivery_status: 'FAILED', delivery_message: 'CNC memory full', delivered_at: '2026-10-21T05:12:00Z' },
                            backup_failure: { message: 'CNC not reachable', at: '2026-10-21T05:13:00Z' } });
  http.expectOne(`${api}/machines`).flush({ data: [refused] });
  expect(toast.error).toHaveBeenCalledWith('VMC-1 could not send a backup: CNC not reachable');
  expect(toast.error).toHaveBeenCalledWith('VMC-1 could not use O1001.nc: CNC memory full');
  files().flush({ data: [], pagination: page });
  expect(c.deliveryLabel({ delivery_status: 'FAILED' })).toBe('Refused by machine');
  expect(c.deliveryLabel({ delivery_status: null })).toBe('Waiting');
  http.verify();
  fixture.destroy();
});
