import { StoredImageDirective } from '../../shared/stored-image.directive';
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  AfterViewInit,
  ChangeDetectorRef,
  ElementRef,
  HostListener,
  DestroyRef,
  inject
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/services/auth.service';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
  ValidatorFn
} from '@angular/forms';

import { MachinesService } from './machines.service';
import { ToastService } from '../../core/services/toast.service';

/** Axis travel and spindle speed are stored as whole numbers. Empty is fine:
 *  a 3-axis machine has no 4th axis. */
const wholeNumber: ValidatorFn = control => {
  const value = control.value;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 2147483647 ? null : { wholeNumber: true };
};

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [StoredImageDirective, CommonModule, ReactiveFormsModule],
  templateUrl: './machine-form.component.html',
  styleUrls: ['./machine-form.component.scss']
})
export class MachineFormComponent implements OnInit, AfterViewInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  uploading = false;
  uploadError = '';
  previewUrl: string | null = null;
  lines: any[] = [];
  filteredLines: any[] = [];
  plants: any[] = [];
  loadingOptions = true;
  optionsError = '';
  saving = false;
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  readonly boundPlantId = this.auth.getUser()?.plant_id ?? null;
  private objectUrl: string | null = null;
  private uploadedPlantId: number | null = null;
  form!: FormGroup;

  /** Rendered as one row so the five axes read as a single group. */
  readonly axes = [
    { key: 'x_axis',      label: 'X axis',   placeholder: '1050' },
    { key: 'y_axis',      label: 'Y axis',   placeholder: '530'  },
    { key: 'z_axis',      label: 'Z axis',   placeholder: '510'  },
    { key: 'fourth_axis', label: '4th axis', placeholder: '360'  },
    { key: 'fifth_axis',  label: '5th axis', placeholder: '120'  }
  ];

  constructor(
    private fb: FormBuilder,
    private service: MachinesService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit() {
    this.destroyRef.onDestroy(() => { if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); });

    this.form = this.fb.group({
      machine_serial_no: ['', Validators.required],
      model: [''],
      image_url: [''],
      controller: [''],
      mmc_no: [''],
      // null, not '': an untouched number box is "not set", never an empty string
      spindle_rpm: [null as number | null, wholeNumber],
      x_axis: [null as number | null, wholeNumber],
      y_axis: [null as number | null, wholeNumber],
      z_axis: [null as number | null, wholeNumber],
      fourth_axis: [null as number | null, wholeNumber],
      fifth_axis: [null as number | null, wholeNumber],
      twin_spindle: [false],
      twin_table: [false],
      atc_tool_capacity: [''],
      plant_id: [this.boundPlantId, Validators.required],
      line_id: [null, Validators.required],
      is_active: [true],
      // what an hour of this machine costs (₹): prices its idle and alarm time
      hour_rate: [null as number | null, [Validators.min(0), Validators.max(1000000)]]
    });
    this.loadLines();
  }

  ngAfterViewInit() {
    // Send focus into the dialog so a keyboard user is not left on the page
    // behind it. The line select is the first thing to fill in.
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#mfPlant')?.focus());
  }

  ////////////////////////////////////////////
  // DIALOG BEHAVIOUR
  ////////////////////////////////////////////

  /** Escape closes, as every dialog is expected to. */
  @HostListener('document:keydown.escape')
  onEscape() { this.close.emit(); }

  /** Click the backdrop to dismiss; clicks inside the card are stopped in the template. */
  onOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('mf-overlay')) this.close.emit();
  }

  /**
   * Keep Tab inside the dialog. Without this, tabbing past the last button
   * walks into the page behind, which is still rendered and clickable.
   */
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event) {
    const event = rawEvent as KeyboardEvent;
    const focusable = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Show an error only once the user has left the field, not while typing. */
  invalid(name: string): boolean {
    const c = this.form?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  ////////////////////////////////////////////
  // LOAD LINES + PATCH DATA
  ////////////////////////////////////////////

  loadLines() {
    this.loadingOptions = true; this.optionsError = '';
    forkJoin({ lines: this.service.getLines(), plants: this.service.getPlants() })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: res => {
          this.lines = res.lines.data || []; this.plants = res.plants.data || [];
          if (this.data) {
            this.form.patchValue({ ...this.data,
              line_id: this.data.line_id != null ? Number(this.data.line_id) : null,
              plant_id: this.boundPlantId ?? (this.data.plant_id != null ? Number(this.data.plant_id) : null),
              hour_rate: this.data.hour_rate != null ? Number(this.data.hour_rate) : null
            });
            this.previewUrl = this.data.image_url;
          }
          const line = this.lines.find(l => Number(l.id) === Number(this.form.value.line_id));
          if (!this.form.value.plant_id) this.form.patchValue({ plant_id: line?.plant_id ?? (this.plants.length === 1 ? this.plants[0].id : null) });
          this.filterLines(); this.loadingOptions = false; this.cdr.markForCheck();
        },
        error: () => { this.loadingOptions = false; this.optionsError = 'Could not load plants and lines. Please retry.'; this.cdr.markForCheck(); }
      });
  }
  private filterLines() {
    const plant = Number(this.form.value.plant_id);
    this.filteredLines = this.lines.filter(line => Number(line.plant_id) === plant);
    if (this.form.value.line_id && !this.filteredLines.some(line => Number(line.id) === Number(this.form.value.line_id))) {
      this.form.patchValue({ line_id: null });
    }
  }
  onPlantChange() {
    this.form.patchValue({ line_id: null });
    this.filterLines();
    if (this.uploadedPlantId && Number(this.form.value.plant_id) !== this.uploadedPlantId) {
      this.releasePreview();
      this.previewUrl = this.data?.image_url || null;
      this.form.patchValue({ image_url: this.previewUrl || '' });
      this.uploadedPlantId = null;
      this.uploadError = 'Plant changed. Upload the photo again for this plant.';
    }
  }

  ////////////////////////////////////////////
  // IMAGE UPLOAD
  ////////////////////////////////////////////

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploading || this.saving) return;
    this.uploadError = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      this.uploadError = 'Choose a JPG, PNG or WebP image up to 5 MB.';
      return;
    }
    const plantId = Number(this.form.value.plant_id);
    if (!Number.isSafeInteger(plantId) || plantId <= 0) {
      this.uploadError = 'Choose the machine plant before uploading a photo.';
      return;
    }
    const previousImage = this.form.get('image_url')?.value || null;
    this.releasePreview();
    this.previewUrl = this.objectUrl = URL.createObjectURL(file);
    this.uploading = true;

    this.service.uploadImage(file, plantId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        if (Number(this.form.value.plant_id) !== plantId) {
          this.releasePreview();
          this.previewUrl = previousImage;
          this.uploadError = 'Plant changed. Upload the photo again for this plant.';
          this.uploading = false;
          this.cdr.markForCheck();
          return;
        }
        this.form.patchValue({ image_url: res.fileUrl });
        this.form.get('image_url')?.markAsDirty();
        this.uploadedPlantId = plantId;
        this.releasePreview();
        this.previewUrl = res.fileUrl;
        this.uploading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.releasePreview();
        this.previewUrl = previousImage;
        this.uploadError = err.error?.message || err.error?.error || 'Image upload failed. Please try again.';
        this.toast.error(this.uploadError);
        this.uploading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private releasePreview(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  ////////////////////////////////////////////
  // SAVE (PRODUCTION SAFE)
  ////////////////////////////////////////////

  save() {
    if (this.saving || this.uploading || this.loadingOptions || this.optionsError) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.cdr.detectChanges();

      // Move focus to the first problem rather than leaving the user to hunt
      // for red borders in a form four sections long.
      const firstInvalid = Object.keys(this.form.controls).find(k => this.form.get(k)?.invalid);
      const map: Record<string, string> = { plant_id: '#mfPlant', line_id: '#mfLine', machine_serial_no: '#mfSerial',
        spindle_rpm: '#mfSpindle', ...Object.fromEntries(this.axes.map(ax => [ax.key, '#mf-' + ax.key])), hour_rate: '#mfRate' };
      const el = firstInvalid && map[firstInvalid]
        ? this.host.nativeElement.querySelector<HTMLElement>(map[firstInvalid])
        : null;
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    if (this.data) {

      // 🔥 Compare values instead of dirty
      const changed: any = {};

      Object.keys(this.form.controls).forEach(key => {
        if (!this.sameAsSaved(key)) {
          changed[key] = this.form.get(key)?.value;
        }
      });

      // Nothing changed → close modal
      if (Object.keys(changed).length === 0) {
        this.close.emit();
        return;
      }

      this.saving = true;
      this.service.update(this.data.id, changed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: err => { this.saving = false; this.toast.error(err.error?.message || 'Could not save the machine.'); this.cdr.markForCheck(); }
      });

    } else {

      // Create → full form; a box left empty is sent as "not set"
      const payload = Object.fromEntries(Object.entries(this.form.value).map(([key, value]) => [key, value === '' ? null : value]));
      this.saving = true;
      this.service.create(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: err => { this.saving = false; this.toast.error(err.error?.message || 'Could not create the machine.'); this.cdr.markForCheck(); }
      });
    }
  }

  ////////////////////////////////////////////
  // OPTIONAL: DISABLE SAVE IF NO CHANGES
  ////////////////////////////////////////////

  get isUnchanged(): boolean {
    if (!this.data) return false;

    return Object.keys(this.form.controls).every(key => this.sameAsSaved(key));
  }

  /** The field still holds what the machine has. The hour rate compares as a
   *  number: 500 in the field and "500.00" from the API are the same rate. */
  private sameAsSaved(key: string): boolean {
    const value = this.form.get(key)?.value;
    if (key === 'hour_rate') {
      const saved = this.data.hour_rate;
      const empty = (v: any) => v === null || v === undefined || v === '';
      return empty(value) || empty(saved) ? empty(value) && empty(saved) : Number(value) === Number(saved);
    }
    return value === this.data[key];
  }
}
