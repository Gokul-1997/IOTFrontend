import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShiftService } from './shift.service';
import { RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-shift-list',
  imports: [CommonModule,RouterModule],
  templateUrl: './shift-list.component.html',
  styleUrls: ['./shift-list.component.scss']
})
export class ShiftListComponent implements OnInit {

  shifts: any[] = [];

  constructor(private service: ShiftService) {}

  ngOnInit() {
    this.service.getAll().subscribe(res => (this.shifts = res));
  }
}
