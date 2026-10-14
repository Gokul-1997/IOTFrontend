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
