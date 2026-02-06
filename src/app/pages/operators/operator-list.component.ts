import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OperatorService } from './operator.service';

@Component({
  standalone: true,
  selector: 'app-operator-list',
  imports: [CommonModule],
  templateUrl: './operator-list.component.html',
  styleUrls: ['./operator-list.component.scss']
})
export class OperatorListComponent implements OnInit {

  operators: any[] = [];

  constructor(private service: OperatorService) {}

  ngOnInit() {
    this.service.getAll().subscribe(res => (this.operators = res));
  }
}
