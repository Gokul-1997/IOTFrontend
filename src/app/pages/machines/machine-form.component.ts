import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MachinesService } from './machines.service';

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './machine-form.component.html'
})
export class MachineFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  uploading = false;
  previewUrl: string | null = null;

  form: any = {
    axis_model: '',
    machine_name: '',
    machine_year: '',
    controller_model: '',
    image_url: ''
  };

  constructor(private service: MachinesService, private cdr: ChangeDetectorRef) { }

  ngOnInit() {

    if (this.data) this.form = { ...this.data };
  }

  onFileSelect(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.previewUrl = URL.createObjectURL(file);  

    this.uploading = true;

    this.service.uploadToS3(file).subscribe({
      next: (res: any) => {
        this.form.image_url = res.fileUrl;
        this.cdr.detectChanges();
        this.uploading = false;
      },
      error: () => {
        alert('Upload failed');
        this.uploading = false;
      }
    });
  }



  save() {
    const req = this.data
      ? this.service.update(this.data.id, this.form)
      : this.service.create(this.form);

    req.subscribe(() => this.saved.emit());
  }
}
