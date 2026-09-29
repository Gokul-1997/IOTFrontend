import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, finalize, of, switchMap } from 'rxjs';
import { ShiftsService } from './shifts.service';
import { DialogFormBase } from '../../shared/dialog-form.base';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-shift-form',
  templateUrl: './shift-form.component.html',
  imports: [CommonModule, ReactiveFormsModule, FormsModule]
})
export class ShiftFormComponent extends DialogFormBase implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  saving = false;
  form!: FormGroup;

  /* ── Break times (edit only: they hang off a saved shift) ──
     When the breaks happen — "Tea Break 11:00–11:15" — for the machine
     page's shift timeline. The Break minutes above stays what planned
     time, and so OEE, uses; these do not change it. */
  readonly MAX_BREAKS = 10;
  breaks: { break_name: string; start_time: string; end_time: string }[] = [];
  breaksLoading = false;
  breaksAvailable = true;      // false before database update 028
  breaksError = '';
  private breaksAtOpen = '[]';

  constructor(
    private fb: FormBuilder,
    private service: ShiftsService,
    private toast: ToastService
  ) { super(); }

  dismiss() { this.close.emit(); }

  ngOnInit() {
    this.form = this.fb.group({
      shift_code:    ['', Validators.required],
      shift_name:    [''],
      start_time:    ['', Validators.required],
      end_time:      ['', Validators.required],
      break_minutes: [0, [Validators.required, Validators.min(0)]],
      is_active:     [true]
    }, { validators: this.shiftValidator });

    if (this.data) {
      this.form.patchValue({
        shift_code:    this.data.shift_code,
        shift_name:    this.data.shift_name,
        start_time:    this.data.start_time?.slice(0, 5),
        end_time:      this.data.end_time?.slice(0, 5),
        break_minutes: this.data.break_minutes,
        is_active:     this.data.is_active !== false
      });
      this.loadBreaks();
    }
  }

  private loadBreaks(): void {
    this.breaksLoading = true;
    this.service.getBreaks(this.data.id).subscribe({
      next: res => {
        this.breaks = (res?.data || []).map((b: any) => ({ break_name: b.break_name, start_time: b.start_time, end_time: b.end_time }));
        this.breaksAtOpen = JSON.stringify(this.breaks);
        this.breaksLoading = false;
        this.touch();
      },
      error: err => {
        this.breaksLoading = false;
        if (err?.status === 503) this.breaksAvailable = false;
        else this.breaksError = err?.error?.message || 'Could not load the break times.';
        this.touch();
      }
    });
  }

  addBreak(): void {
    if (this.breaks.length >= this.MAX_BREAKS) return;
    this.breaks = [...this.breaks, { break_name: '', start_time: '', end_time: '' }];
    this.breaksError = '';
    this.touch();
    // focus the new row's name, so a keyboard user carries straight on
    setTimeout(() => document.getElementById(`brkName${this.breaks.length - 1}`)?.focus());
  }

  removeBreak(i: number): void {
    this.breaks = this.breaks.filter((_, j) => j !== i);
    this.breaksError = '';
    this.touch();
  }

  /** The break windows' total, to set beside the Break minutes above. */
  get breaksTotal(): number {
    return this.breaks.reduce((n, b) => {
      if (!b.start_time || !b.end_time) return n;
      return n + ((this.timeToMinutes(b.end_time) - this.timeToMinutes(b.start_time) + 1440) % 1440);
    }, 0);
  }

  private get breaksChanged(): boolean { return JSON.stringify(this.breaks) !== this.breaksAtOpen; }

  /** Said before sending; the server also checks each one falls inside the
   *  shift and that none overlap. */
  private checkBreaks(): boolean {
    for (const [i, b] of this.breaks.entries()) {
      const name = b.break_name.trim() || `Break ${i + 1}`;
      if (!b.break_name.trim()) { this.breaksError = `${name} needs a name.`; return false; }
      if (!b.start_time || !b.end_time) { this.breaksError = `${name} needs a start and an end time.`; return false; }
      if (b.start_time === b.end_time) { this.breaksError = `${name}: the end must be after the start.`; return false; }
    }
    this.breaksError = '';
    return true;
  }

  shiftValidator = (group: AbstractControl): ValidationErrors | null => {
    const start    = group.get('start_time')?.value;
    const end      = group.get('end_time')?.value;
    const breakMin = Number(group.get('break_minutes')?.value || 0);

    if (!start || !end) return null;

    const startMin = this.timeToMinutes(start);
    const endMin   = this.timeToMinutes(end);

    let duration: number;
    if (startMin === endMin) {
      duration = 1440;
    } else if (endMin > startMin) {
      duration = endMin - startMin;
    } else {
      duration = (1440 - startMin) + endMin;
    }

    if (duration <= 0 || duration > 1440) return { invalidDuration: true };
    if (breakMin >= duration)             return { invalidBreak: true };
    return null;
  };

  private timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    if (this.data && this.breaksAvailable && !this.checkBreaks()) { this.touch(); return; }

    this.saving = true;
    const payload = { ...this.form.value, break_minutes: Number(this.form.value.break_minutes) };

    if (this.data) {
      const changed: any = {};
      Object.keys(payload).forEach(key => {
        // DB returns times as "HH:MM:SS" — normalize to "HH:MM" before comparing
        const dataVal = (key === 'start_time' || key === 'end_time')
          ? (this.data[key] ?? '').toString().slice(0, 5)
          : this.data[key];
        if (payload[key] !== dataVal) changed[key] = payload[key];
      });

      const saveBreaks = this.breaksAvailable && this.breaksChanged;
      if (Object.keys(changed).length === 0 && !saveBreaks) {
        this.saving = false;
        this.close.emit();
        return;
      }

      /* The shift first: the breaks are checked against its hours, so a
         shift moved later and a break moved with it both go through. */
      const shift$: Observable<unknown> = Object.keys(changed).length ? this.service.update(this.data.id, changed) : of(null);
      let shiftSaved = false;
      shift$.pipe(
        switchMap(() => {
          shiftSaved = true;
          // a retry after a refused break list must not re-send the shift
          this.data = { ...this.data, ...changed };
          const breaks$: Observable<unknown> = saveBreaks ? this.service.saveBreaks(this.data.id, this.breaks) : of(null);
          return breaks$;
        }),
        finalize(() => { this.saving = false; this.touch(); })
      ).subscribe({
        next: () => this.saved.emit(),
        error: (err: any) => {
          this.saving = false;
          if (shiftSaved) {
            // the shift is saved; only the breaks were refused — say why, in place
            this.breaksError = err?.error?.message || 'The break times could not be saved.';
          } else {
            this.toast.error(err?.error?.message || 'Update failed. Try again.');
          }
          this.touch();
        }
      });
    } else {
      this.service.create(payload)
        .pipe(finalize(() => { this.saving = false; this.touch(); }))
        .subscribe({
          next: () => this.saved.emit(),
          error: (err: any) => {
            this.saving = false;
            this.touch();
            this.toast.error(err?.error?.message || 'Create failed. Try again.');
          }
        });
    }
  }

  openTimePicker(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.showPicker) input.showPicker();
  }
}
