import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MachinesService } from './machines.service';

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './machine-form.component.html'
})
export class MachineFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  uploading = false;
  previewUrl: string | null = null;
  lines: any[] = [];
  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: MachinesService
  ) { }


  ngOnInit() {

    this.form = this.fb.group({
      machine_name: ['', Validators.required],
      axis_model: [''],
      controller_model: [''],
      machine_year: [''],
      image_url: [''],
      line_id: [null, Validators.required]
    });

    if (this.data) {
      this.form.patchValue(this.data);
      this.previewUrl = this.data.image_url;
    }

    this.loadLines();
  }

  loadLines() {
  this.service.getLines().subscribe(res => {
    this.lines = res.data;
    if (this.data) {
      this.form.patchValue({
        ...this.data,
        line_id: Number(this.data.line_id) 
      });

      this.previewUrl = this.data.image_url;
    }
  });
}

  onFileSelect(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.previewUrl = URL.createObjectURL(file);
    this.uploading = true;

    this.service.uploadToS3(file).subscribe({
      next: (res: any) => {
        this.form.patchValue({ image_url: res.fileUrl });
        this.uploading = false;
      },
      error: () => {
        alert('Upload failed');
        this.uploading = false;
      }
    });
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const req = this.data
      ? this.service.update(this.data.id, this.form.value)
      : this.service.create(this.form.value);

    req.subscribe(() => this.saved.emit());
  }
}