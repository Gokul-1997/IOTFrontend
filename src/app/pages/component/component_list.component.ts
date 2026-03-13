import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ComponentApi } from './component.api';
import { SocketService } from '../../core/services/socket.service';
@Component({
  selector: 'app-component-list',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './component_list.component.html'
})
export class ComponentList implements OnInit {

  form!: FormGroup;

  components: any[] = [];
  machines: any[] = [];   // must exist

  page = 1;
  limit = 6;
  total = 0;
  search = '';
  showModal = false;  // must exist
  editing = false;    // must exist
  editingId: number | null = null;

  constructor(
    private fb: FormBuilder,
    private api: ComponentApi,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    this.initForm();
    this.load();
    this.loadMachines();
  }

  loadMachines() {
    this.api.getMachines().subscribe(res => {
      this.machines = res.data;
    });
  }
  /* ================= FORM ================= */

  initForm() {
    this.form = this.fb.group({
      machine_id: ['', Validators.required],
      part_name: ['', Validators.required],
      part_number: [''],
      operation_number: [''],
      cycle_time: ['', [
        Validators.required,
        Validators.pattern(/^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/)
      ]],
      target: ['', Validators.required],
      multiplication_factor: [1]
    });
  }

  /* ================= LOAD DATA ================= */

  load() {
    this.api.list(this.page, this.limit, this.search)
      .subscribe(res => {
        this.components = res.data;
        this.total = res.meta.total;
                this.cdr.markForCheck();

      });
  }
formatCycleTimeTable(t: any): string {

  if (!t) return '00:00:00';

  const h = String(t.hours ?? 0).padStart(2,'0');
  const m = String(t.minutes ?? 0).padStart(2,'0');
  const s = String(t.seconds ?? 0).padStart(2,'0');

  return `${h}:${m}:${s}`;
}
  formatCycleTime(event: any) {

    let value = event.target.value.replace(/\D/g, ''); // remove letters

    if (value.length > 6) {
      value = value.substring(0, 6);
    }

    if (value.length >= 5) {
      value = value.replace(/^(\d{2})(\d{2})(\d{1,2})$/, '$1:$2:$3');
    } else if (value.length >= 3) {
      value = value.replace(/^(\d{2})(\d{1,2})$/, '$1:$2');
    }

    this.form.patchValue({ cycle_time: value }, { emitEvent: false });
  }

  /* ================= MODAL ================= */

  openModal() {
    this.showModal = true;
    this.editing = false;
    this.form.reset();
  }

  closeModal() {
    this.showModal = false;
    this.editing = false;
    this.editingId = null;
  }

  /* ================= SUBMIT ================= */

  submit() {

    if (this.form.invalid) return;

    const time = this.form.value.cycle_time;

    if (!/^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.test(time)) {
      alert("Invalid cycle time");
      return;
    }

    this.api.create(this.form.value).subscribe(() => {
      this.load();
      this.closeModal();
    });
  }

  /* ================= EDIT ================= */

  edit(data: any) {
    this.editing = true;
    this.editingId = data.id;
    this.showModal = true;

    this.form.patchValue(data);
  }

  /* ================= DELETE ================= */

  delete(id: number) {
    if (!confirm('Are you sure?')) return;

    this.api.delete(id).subscribe(() => {
      this.load();
    });
  }

  /* ================= SEARCH ================= */

  searchData() {
    this.page = 1;
    this.load();
  }

  /* ================= PAGINATION ================= */

  next() {
    if (this.page * this.limit < this.total) {
      this.page++;
      this.load();
    }
  }

  prev() {
    if (this.page > 1) {
      this.page--;
      this.load();
    }
  }
  
}