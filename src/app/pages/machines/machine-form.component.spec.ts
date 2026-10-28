import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { MachineFormComponent } from './machine-form.component';
import { MachinesService } from './machines.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { StoredImageService } from '../../core/services/stored-image.service';

let fixture: ComponentFixture<MachineFormComponent>, form: MachineFormComponent;
let upload: Subject<{ fileUrl: string }>, service: any, revoked: ReturnType<typeof vi.fn>;
const existing = 'https://old-bucket.s3.example/machine.jpg';
beforeEach(async () => {
  upload = new Subject();
  service = {
    getLines: vi.fn().mockReturnValue(of({ data: [{ id: 3, plant_id: 2 }] })),
    getPlants: vi.fn().mockReturnValue(of({ data: [{ id: 2, name: 'Plant' }] })),
    uploadImage: vi.fn().mockReturnValue(upload), update: vi.fn().mockReturnValue(of({})), create: vi.fn().mockReturnValue(of({}))
  };
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn().mockReturnValue('blob:preview') });
  revoked = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoked });
  await TestBed.configureTestingModule({ imports: [MachineFormComponent], providers: [
    { provide: MachinesService, useValue: service }, { provide: ToastService, useValue: { error: vi.fn() } },
    { provide: AuthService, useValue: { getUser: () => ({ plant_id: 2 }) } },
    { provide: StoredImageService, useValue: { protectedUrl: () => null } }
  ] }).compileComponents();
  fixture = TestBed.createComponent(MachineFormComponent);
  form = fixture.componentInstance;
  form.data = { id: 9, machine_serial_no: 'CNC-9', plant_id: 2, line_id: 3, image_url: existing };
  fixture.detectChanges();
});
afterEach(() => { fixture.destroy(); });
function select(file: File) {
  form.onFileSelect({ target: { files: [file], value: 'photo' } } as unknown as Event);
}

test('unsupported and oversized images never upload or replace the saved photo', () => {
  select(new File(['<svg/>'], 'machine.svg', { type: 'image/svg+xml' }));
  expect(form.uploadError).toContain('JPG, PNG or WebP');
  select(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'machine.png', { type: 'image/png' }));
  expect(service.uploadImage).not.toHaveBeenCalled();
  expect(form.form.value.image_url).toBe(existing);
  expect(form.previewUrl).toBe(existing);
});

test('upload sends machine plant and blocks machine saving until the image is safely stored', () => {
  const photo = new File(['image'], 'machine.webp', { type: 'image/webp' });
  select(photo);
  expect(service.uploadImage).toHaveBeenCalledWith(photo, 2);
  expect(form.previewUrl).toBe('blob:preview');
  form.save(); expect(service.update).not.toHaveBeenCalled();
  const reference = '/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.webp';
  upload.next({ fileUrl: reference }); upload.complete();
  expect(form.form.value.image_url).toBe(reference);
  expect(form.previewUrl).toBe(reference);
  expect(revoked).toHaveBeenCalledWith('blob:preview');
  expect(form.uploading).toBe(false);
  form.save(); expect(service.update).toHaveBeenCalledWith(9, expect.objectContaining({ image_url: reference }));
});

test('an upload error restores the actual saved image and allows retry', () => {
  select(new File(['image'], 'machine.jpg', { type: 'image/jpeg' }));
  upload.error({ error: { message: 'Storage unavailable' } });
  expect(form.previewUrl).toBe(existing);
  expect(form.form.value.image_url).toBe(existing);
  expect(form.uploadError).toBe('Storage unavailable');
  expect(form.uploading).toBe(false);
  expect(revoked).toHaveBeenCalledWith('blob:preview');
});

test('a company-wide user chooses a plant before the backend gets a photo', () => {
  form.form.patchValue({ plant_id: null });
  select(new File(['image'], 'machine.jpg', { type: 'image/jpeg' }));
  expect(service.uploadImage).not.toHaveBeenCalled();
  expect(form.uploadError).toContain('Choose the machine plant');
});

test('a selected plant changed during upload cannot attach the first plant photo', () => {
  select(new File(['image'], 'machine.jpg', { type: 'image/jpeg' }));
  form.form.patchValue({ plant_id: 8 });
  upload.next({ fileUrl: '/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.jpg' });
  expect(form.form.value.image_url).toBe(existing);
  expect(form.previewUrl).toBe(existing);
  expect(form.uploadError).toContain('Plant changed');
  expect(form.uploading).toBe(false);
});

test('moving a new photo to another plant resets that photo with an actionable retry message', () => {
  select(new File(['image'], 'machine.jpg', { type: 'image/jpeg' }));
  upload.next({ fileUrl: '/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.jpg' });
  form.form.patchValue({ plant_id: 8 }); form.onPlantChange();
  expect(form.form.value.image_url).toBe(existing);
  expect(form.uploadError).toContain('Upload the photo again');
});

/* 28 Oct 2026, the user: a saved photo could only be replaced — a remove icon in its top corner */
test('the corner icon removes the photo; it goes on Save, and the machine then has none', () => {
  const remove = () => fixture.nativeElement.querySelector('button.mf-image-remove') as HTMLButtonElement | null;
  expect(remove()?.getAttribute('aria-label')).toBe('Remove photo');
  expect(remove()?.closest('label')).toBeNull();                         // never opens the file picker
  remove()!.click(); fixture.detectChanges();
  expect(form.previewUrl).toBeNull();
  expect(form.form.value.image_url).toBe('');
  expect(remove()).toBeNull();                                           // nothing left to remove
  expect(fixture.nativeElement.textContent).toContain('Add a photo');
  expect(service.update).not.toHaveBeenCalled();                         // nothing goes until Save
  form.save();
  expect(service.update).toHaveBeenLastCalledWith(9, expect.objectContaining({ image_url: '' }));   // stored as no photo
});

test('a photo cannot be removed while one is uploading', () => {
  select(new File(['image'], 'machine.jpg', { type: 'image/jpeg' }));
  expect(form.uploading).toBe(true);                                     // the icon is hidden while uploading
  form.removeImage();
  expect(form.form.value.image_url).toBe(existing);
});

describe('a new machine', () => {
  let created: ComponentFixture<MachineFormComponent>, fresh: MachineFormComponent;
  beforeEach(() => {
    created = TestBed.createComponent(MachineFormComponent);
    fresh = created.componentInstance;
    created.detectChanges();
    fresh.form.patchValue({ machine_serial_no: 'VMC-12', line_id: 3, x_axis: 1050, y_axis: 530, z_axis: 510 });
  });
  afterEach(() => created.destroy());

  // 15 Oct 2026: the untouched 4th-axis box went out as "" and the API's
  // integer column refused it — the machine could not be created.
  test('boxes left empty are sent as not set, never as empty text', () => {
    fresh.save();
    const sent = service.create.mock.calls[0][0];
    expect(sent).toMatchObject({ machine_serial_no: 'VMC-12', plant_id: 2, line_id: 3, x_axis: 1050,
      fourth_axis: null, fifth_axis: null, spindle_rpm: null, model: null, atc_tool_capacity: null });
    expect(Object.values(sent)).not.toContain('');
  });

  // 23 Oct 2026, the user: "machine page — where is the machine IP?"
  test('the machine IP goes with the machine; one that is not an IP address is caught on the form', () => {
    fresh.form.patchValue({ ip_address: ' 192.168.1.101 ' });
    fresh.save();
    expect(service.create.mock.calls[0][0]).toMatchObject({ ip_address: ' 192.168.1.101 ' });   // the server trims it
    service.create.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    for (const bad of ['192.168.1', '192.168.1.256', 'cnc01.local', '192.168.01.1']) {
      fresh.form.patchValue({ ip_address: bad });
      fresh.save();
      expect(service.create).not.toHaveBeenCalled();
      expect(document.activeElement?.id).toBe('mfIp');
    }
    created.detectChanges();
    expect(created.nativeElement.querySelector('#mfIpErr')?.textContent).toContain('Enter an IP address such as 192.168.1.101.');
  });

  // 23 Oct 2026, the user: "the controller — one more dropdown, Fanuc or Mitsubishi — and in the status API"
  test('the controller type: Fanuc or Mitsubishi from its dropdown goes with the machine; not set goes as null', () => {
    const select: HTMLSelectElement = created.nativeElement.querySelector('#mfControllerType');
    expect([...select.options].map(o => o.textContent?.trim())).toEqual(['Not set', 'Fanuc', 'Mitsubishi']);
    fresh.save();
    expect(service.create.mock.calls[0][0]).toMatchObject({ controller_type: null });
    service.create.mockClear();
    fresh.form.patchValue({ controller_type: 'MITSUBISHI' });
    fresh.save();
    expect(service.create.mock.calls[0][0]).toMatchObject({ controller_type: 'MITSUBISHI' });
  });

  // 23 Oct 2026, the user: "the machine's program path, from the Machines page, in the gateway's status"
  test('the program path goes with the machine; one the gateway must not be given is caught on the form', () => {
    fresh.form.patchValue({ program_path: '//CNC_MEM/USER/PATH1/' });
    fresh.save();
    expect(service.create.mock.calls[0][0]).toMatchObject({ program_path: '//CNC_MEM/USER/PATH1/' });

    service.create.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    for (const bad of ['//CNC_MEM/../../etc', 'C:\\DNC\\..\\Windows', '/p; rm -rf /', '$(id)', 'p'.repeat(256)]) {
      fresh.form.patchValue({ program_path: bad });
      fresh.save();
      expect(service.create).not.toHaveBeenCalled();
      expect(document.activeElement?.id).toBe('mfProgramPath');
    }
    created.detectChanges();
    expect(created.nativeElement.querySelector('#mfProgramPathErr')?.textContent).toContain('without ".."');
    fresh.form.patchValue({ program_path: 'M01:\\PRG\\USER\\' });            // a Mitsubishi folder is a path too
    expect(fresh.form.get('program_path')?.valid).toBe(true);
  });

  test('a part-millimetre or negative travel is caught on the form, not by the server', () => {
    const scrolled = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrolled });
    fresh.form.patchValue({ fourth_axis: 360.5, spindle_rpm: -1 });
    fresh.save();
    expect(service.create).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('mfSpindle');     // the first bad box gets focus
    expect(scrolled).toHaveBeenCalled();
    expect(fresh.invalid('fourth_axis')).toBe(true);
    expect(fresh.invalid('spindle_rpm')).toBe(true);
    created.detectChanges();
    expect(created.nativeElement.querySelector('#mf-fourth_axis-err')?.textContent).toContain('Whole number');
    expect(created.nativeElement.querySelector('#mf-fourth_axis').getAttribute('aria-describedby')).toBe('mf-fourth_axis-err');
  });
});

/* The machine's own telemetry reports its IP: that is the gateway's address for it, and a typed one is
   used only while it reports none — the form shows the reported one, and says so when another is typed. */
test('the machine reports its own IP: shown in the empty box; a different one typed is said to be unused', () => {
  const opened = TestBed.createComponent(MachineFormComponent);
  opened.componentInstance.data = { id: 9, machine_serial_no: 'CNC-9', plant_id: 2, line_id: 3, controller_ip: '192.168.1.10' };
  opened.detectChanges();
  const input: HTMLInputElement = opened.nativeElement.querySelector('#mfIp');
  expect(input.placeholder).toBe('192.168.1.10 (reported by the machine)');
  expect(opened.nativeElement.querySelector('#mfIpNote')).toBeNull();
  const type = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); opened.detectChanges(); };
  type('192.168.1.99');
  expect(opened.nativeElement.querySelector('#mfIpNote')?.textContent).toContain('The machine reports 192.168.1.10: the gateway uses that one.');
  expect(input.getAttribute('aria-describedby')).toBe('mfIpNote');
  type('192.168.1.10');                                             // the same address: nothing to say
  expect(opened.nativeElement.querySelector('#mfIpNote')).toBeNull();
  opened.destroy();
});
